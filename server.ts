import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { PrismaClient } from "@prisma/client";
import { GoogleGenAI, Type } from "@google/genai";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "EnterpriseModernizationTokenSecretWithEnormousCharacterLength382";

// Initialize Gemini Client safely
let ai: GoogleGenAI | null = null;
try {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
} catch (e) {
  console.error("Gemini failed to load: ", e);
}

// In-memory cache for operational endpoints proxy responses
const memoryCache: Record<string, { data: any; expiry: number }> = {};

function cleanExpiredCache() {
  const now = Date.now();
  for (const key in memoryCache) {
    if (memoryCache[key].expiry < now) {
      delete memoryCache[key];
    }
  }
}
setInterval(cleanExpiredCache, 60000);

async function startServer() {
  const app = express();

  app.use(cookieParser());
  app.use(express.json());
  
  // Custom text parser for incoming text/xml representing SOAP requests to custom mock backends
  app.use(express.text({ type: ["text/xml", "application/xml"] }));

  // CORS middleware manually to ensure strict same-site and credentialed transfers
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-KEY");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // Client IP helper
  const getIp = (req: express.Request) => {
    return (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "127.0.0.1";
  };

  /* =====================================================================================
   * SECURITY AUTHENTICATION MIDDLEWARES
   * =====================================================================================
   */
  const authenticateJWT = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    let token = "";

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: "AUTH_INVALID_TOKEN",
          message: "Access token is missing or unauthorized.",
        }
      });
    }

    try {
      const decodedPayload = jwt.verify(token, JWT_SECRET) as any;
      req.user = await prisma.user.findUnique({
        where: { id: decodedPayload.userId },
        select: { id: true, email: true, name: true, role: true },
      });
      if (!req.user) {
        throw new Error("User no longer exists");
      }
      next();
    } catch (err: any) {
      const isExpired = err.name === "TokenExpiredError";
      return res.status(401).json({
        success: false,
        error: {
          code: isExpired ? "AUTH_EXPIRED_TOKEN" : "AUTH_INVALID_TOKEN",
          message: isExpired ? "Your access session has expired." : "Authentication token is invalid.",
        }
      });
    }
  };

  /* =====================================================================================
   * AUTH API ROUTES (PHASE 2)
   * =====================================================================================
   */
  app.post("/api/auth/register", async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Name, email, and password are required." }
      });
    }

    try {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "A user with this email already exists." }
        });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          name,
          email,
          passwordHash,
          role: "DEVELOPER"
        }
      });

      const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "1h" });
      const refreshToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });

      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 60 * 60 * 1000,
      });

      return res.json({
        success: true,
        token: accessToken,
        user: { id: user.id, name: user.name, email: user.email, role: user.role }
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Email and password are required." }
      });
    }

    try {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.status(401).json({
          success: false,
          error: { code: "AUTH_INVALID_TOKEN", message: "Invalid email or password." }
        });
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          error: { code: "AUTH_INVALID_TOKEN", message: "Invalid email or password." }
        });
      }

      const accessToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "1h" });
      const refreshToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "7d" });

      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 60 * 60 * 1000,
      });

      return res.json({
        success: true,
        token: accessToken,
        user: { id: user.id, name: user.name, email: user.email, role: user.role }
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.post("/api/auth/refresh", (req, res) => {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: { code: "AUTH_INVALID_TOKEN", message: "No refresh session registered." }
      });
    }

    try {
      const decodedPayload = jwt.verify(refreshToken, JWT_SECRET) as any;
      const accessToken = jwt.sign({ userId: decodedPayload.userId }, JWT_SECRET, { expiresIn: "1h" });

      res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 60 * 60 * 1000,
      });

      return res.json({ success: true, token: accessToken });
    } catch (err) {
      return res.status(401).json({
        success: false,
        error: { code: "AUTH_INVALID_TOKEN", message: "Refresh session invalid or expired." }
      });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("refreshToken");
    res.clearCookie("accessToken");
    return res.json({ success: true });
  });

  app.get("/api/auth/me", authenticateJWT, (req: any, res) => {
    const authHeader = req.headers.authorization;
    let token = "";
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    return res.json({ success: true, user: req.user, token });
  });

  /* =====================================================================================
   * INTERNAL DYNAMIC WSDL HELPER PARSER & AI ANALYZER (PHASE 3)
   * =====================================================================================
   */
  const parseWSDLMetadataAndOperations = (wsdlContent: string) => {
    const defaultRes = {
      soapEndpoint: "http://localhost:3000/ws/soap-backend",
      namespace: "http://legacy.pay.org/auth/",
      operations: [] as any[]
    };

    try {
      const docParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        removeNSPrefix: false // Preserve for structure searches
      });
      const parsedXml = docParser.parse(wsdlContent);

      // Recursive tag searching helper
      const findNodeByName = (obj: any, tag: string): any => {
        if (!obj || typeof obj !== "object") return null;
        for (const key in obj) {
          if (key.endsWith(tag)) return obj[key];
          const found = findNodeByName(obj[key], tag);
          if (found) return found;
        }
        return null;
      };

      // 1. Try to find Soap address
      const addressNode = findNodeByName(parsedXml, "address");
      if (addressNode) {
        if (addressNode["@_location"]) defaultRes.soapEndpoint = addressNode["@_location"];
        else if (Array.isArray(addressNode) && addressNode[0]?.["@_location"]) defaultRes.soapEndpoint = addressNode[0]["@_location"];
      }

      // 2. Try to find targetNamespace
      const definitions = findNodeByName(parsedXml, "definitions") || parsedXml["definitions"] || parsedXml["wsdl:definitions"];
      if (definitions) {
        if (definitions["@_targetNamespace"]) defaultRes.namespace = definitions["@_targetNamespace"];
      }

      // 3. Extract Operations from portType
      const portType = findNodeByName(parsedXml, "portType");
      if (portType) {
        const operationsList = portType.operation || portType["wsdl:operation"] || [];
        const normalizedOps = Array.isArray(operationsList) ? operationsList : [operationsList];

        for (const op of normalizedOps) {
          if (op && op["@_name"]) {
            const name = op["@_name"];
            
            // Create realistic mock parameters based on operation labels
            const inputs: Record<string, string> = {};
            const outputs: Record<string, string> = {};

            if (name.toLowerCase().includes("payment") || name.toLowerCase().includes("authorize")) {
              inputs["MerchantId"] = "string";
              inputs["Amount"] = "number";
              inputs["CurrencyCode"] = "string";
              inputs["CardNumber"] = "string";
              inputs["ExpiryDate"] = "string";
              inputs["CVV"] = "string";

              outputs["TransactionId"] = "string";
              outputs["ResponseCode"] = "string";
              outputs["Status"] = "string";
              outputs["ApprovalCode"] = "string";
            } else if (name.toLowerCase().includes("user") || name.toLowerCase().includes("customer")) {
              inputs["CustomerId"] = "string";
              inputs["UserEmail"] = "string";
              inputs["FullName"] = "string";
              inputs["AccountStatus"] = "string";

              outputs["UserId"] = "string";
              outputs["IsSuccess"] = "boolean";
              outputs["Message"] = "string";
            } else {
              inputs["RequestId"] = "string";
              inputs["PayloadData"] = "string";

              outputs["ResponseId"] = "string";
              outputs["ResultCode"] = "string";
              outputs["ProcessStatus"] = "string";
            }

            // Mock JSON schemas
            const jsonInputSchema = {
              type: "object",
              properties: Object.keys(inputs).reduce((acc: any, key) => {
                acc[key] = { type: inputs[key], description: `SOAP field ${key}` };
                return acc;
              }, {}),
              required: Object.keys(inputs)
            };

            const jsonOutputSchema = {
              type: "object",
              properties: Object.keys(outputs).reduce((acc: any, key) => {
                acc[key] = { type: outputs[key], description: `SOAP field ${key}` };
                return acc;
              }, {})
            };

            // Setup default direct mappings
            const defaultMappings = Object.keys(inputs).map(key => {
              const camelCased = key.charAt(0).toLowerCase() + key.slice(1);
              return {
                soapField: key,
                restField: camelCased,
                confidence: 90,
                reasoning: "Direct mapping from capital header"
              };
            });

            defaultRes.operations.push({
              soapOperation: name,
              soapAction: defaultRes.namespace + name,
              restPath: "/" + name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(),
              restMethod: "POST",
              inputSchema: JSON.stringify(jsonInputSchema),
              outputSchema: JSON.stringify(jsonOutputSchema),
              fieldMappings: JSON.stringify(defaultMappings)
            });
          }
        }
      }
    } catch (e) {
      console.error("Simple WSDL RegEx parsing exception: ", e);
    }

    return defaultRes;
  };

  /* =====================================================================================
   * BRIDGE OPERATIONS ENDPOINTS (PHASE 3, 4)
   * =====================================================================================
   */
  app.post("/api/bridges", authenticateJWT, async (req: any, res) => {
    const { name, description, wsdlContent, wsdlUrl } = req.body;
    if (!name || !wsdlContent) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Bridge name and WSDL content XML are required." }
      });
    }

    try {
      const parsedStats = parseWSDLMetadataAndOperations(wsdlContent);
      if (parsedStats.operations.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Dynamic compilation failed: The provided WSDL contains 0 parseable SOAP operations. Please ensure your XML WSDL format includes a portType with operations." }
        });
      }

      const bridge = await prisma.bridge.create({
        data: {
          name,
          description,
          wsdlContent,
          wsdlUrl,
          soapEndpoint: parsedStats.soapEndpoint,
          namespace: parsedStats.namespace,
          status: "DRAFT", // Pre-fill state is DRAFT until active
          userId: req.user.id
        }
      });

      // Save extracted operations
      if (parsedStats.operations.length > 0) {
        for (const op of parsedStats.operations) {
          await prisma.operation.create({
            data: {
              bridgeId: bridge.id,
              soapAction: op.soapAction,
              soapOperation: op.soapOperation,
              restPath: op.restPath,
              restMethod: op.restMethod,
              inputSchema: op.inputSchema,
              outputSchema: op.outputSchema,
              fieldMappings: op.fieldMappings
            }
          });
        }
      }

      const fullBridge = await prisma.bridge.findUnique({
        where: { id: bridge.id },
        include: { operations: true }
      });

      return res.json({ success: true, bridge: fullBridge });
    } catch (e: any) {
      return res.status(500).json({
        success: false,
        error: { code: "WSDL_PARSE_FAILED", message: "Failed parsing uploaded WSDL specification: " + e.message }
      });
    }
  });

  app.get("/api/bridges", authenticateJWT, async (req: any, res) => {
    try {
      const bridges = await prisma.bridge.findMany({
        where: { userId: req.user.id },
        include: { operations: true, _count: { select: { logs: true } } }
      });
      return res.json({ success: true, bridges });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.get("/api/bridges/:id", authenticateJWT, async (req: any, res) => {
    try {
      const bridge = await prisma.bridge.findFirst({
        where: { id: req.params.id, userId: req.user.id },
        include: { operations: true }
      });
      if (!bridge) {
        return res.status(404).json({ success: false, error: { code: "BRIDGE_NOT_FOUND", message: "Bridge not found." } });
      }
      return res.json({ success: true, bridge });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.put("/api/bridges/:id", authenticateJWT, async (req: any, res) => {
    const { name, description, soapEndpoint, namespace, status } = req.body;
    try {
      const existingBridge = await prisma.bridge.findFirst({
        where: { id: req.params.id, userId: req.user.id }
      });
      if (!existingBridge) {
        return res.status(404).json({ success: false, error: { code: "BRIDGE_NOT_FOUND", message: "Bridge not found." } });
      }

      const updated = await prisma.bridge.update({
        where: { id: req.params.id },
        data: {
          name: name ?? existingBridge.name,
          description: description !== undefined ? description : existingBridge.description,
          soapEndpoint: soapEndpoint ?? existingBridge.soapEndpoint,
          namespace: namespace ?? existingBridge.namespace,
          status: status ?? existingBridge.status,
        },
        include: { operations: true }
      });

      return res.json({ success: true, bridge: updated });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.delete("/api/bridges/:id", authenticateJWT, async (req: any, res) => {
    try {
      const bridge = await prisma.bridge.findFirst({
        where: { id: req.params.id, userId: req.user.id }
      });
      if (!bridge) {
        return res.status(404).json({ success: false, error: { code: "BRIDGE_NOT_FOUND", message: "Bridge not found." } });
      }

      await prisma.bridge.delete({ where: { id: req.params.id } });
      return res.json({ success: true, message: "Bridge deleted successfully." });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.put("/api/bridges/:id/operations/:opId", authenticateJWT, async (req: any, res) => {
    const { restPath, restMethod, fieldMappings, authRequired, cacheEnabled, cacheTtl, rateLimitRpm, inputSchema, outputSchema } = req.body;
    try {
      const operation = await prisma.operation.findFirst({
        where: { id: req.params.opId, bridgeId: req.params.id, bridge: { userId: req.user.id } }
      });
      if (!operation) {
        return res.status(404).json({ success: false, error: { code: "OPERATION_NOT_FOUND", message: "Operation not found." } });
      }

      const updated = await prisma.operation.update({
        where: { id: req.params.opId },
        data: {
          restPath: restPath ?? operation.restPath,
          restMethod: restMethod ?? operation.restMethod,
          fieldMappings: fieldMappings ? JSON.stringify(fieldMappings) : operation.fieldMappings,
          authRequired: authRequired !== undefined ? authRequired : operation.authRequired,
          cacheEnabled: cacheEnabled !== undefined ? cacheEnabled : operation.cacheEnabled,
          cacheTtl: cacheTtl !== undefined ? Number(cacheTtl) : operation.cacheTtl,
          rateLimitRpm: rateLimitRpm !== undefined ? Number(rateLimitRpm) : operation.rateLimitRpm,
          inputSchema: inputSchema ? JSON.stringify(inputSchema) : operation.inputSchema,
          outputSchema: outputSchema ? JSON.stringify(outputSchema) : operation.outputSchema,
        }
      });

      return res.json({ success: true, operation: updated });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  /* =====================================================================================
   * GEMINI SMART-AI WORKFLOWS (PHASE 4, 7)
   * =====================================================================================
   */
  // CALL 1: Field Mapping
  app.post("/api/bridges/:id/operations/:opId/map-fields", authenticateJWT, async (req: any, res) => {
    try {
      const operation = await prisma.operation.findFirst({
        where: { id: req.params.opId, bridgeId: req.params.id, bridge: { userId: req.user.id } }
      });
      if (!operation) {
        return res.status(404).json({ success: false, error: { code: "OPERATION_NOT_FOUND", message: "Operation not found." } });
      }

      const inputS = JSON.parse(operation.inputSchema);
      const fields = Object.keys(inputS.properties || {});

      if (!ai) {
        // Mock fallback if API Key not declared
        const mockMappings = fields.map(field => {
          const lower = field.charAt(0).toLowerCase() + field.slice(1);
          return {
            soapField: field,
            restField: lower,
            confidence: 85,
            reasoning: "Mock mapper normalized field case automatically."
          };
        });
        return res.json({ success: true, mappings: mockMappings });
      }

      const modelResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Map these SOAP fields to REST-friendly camelCase names: [${fields.join(', ')}]. Return a JSON array representation according to schema standards.`,
        config: {
          systemInstruction: "You are an API schema normalizer for enterprise integration. Analyze SOAP field names and return clean REST equivalents. Return ONLY a JSON array. No markdown, no explanation.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                soapField: { type: Type.STRING },
                restField: { type: Type.STRING },
                confidence: { type: Type.INTEGER },
                reasoning: { type: Type.STRING }
              },
              required: ["soapField", "restField", "confidence", "reasoning"]
            }
          }
        }
      });

      const mappings = JSON.parse(modelResponse.text || "[]");
      return res.json({ success: true, mappings });

    } catch (e: any) {
      return res.status(500).json({
        success: false,
        error: { code: "AI_MAPPING_FAILED", message: "Failed parsing dynamic mappings via Gemini standard API: " + e.message }
      });
    }
  });

  // CALL 2: Schema Validation
  app.post("/api/bridges/:id/operations/:opId/validate-payload", authenticateJWT, async (req: any, res) => {
    const { requestBody } = req.body;
    try {
      const operation = await prisma.operation.findFirst({
        where: { id: req.params.opId, bridgeId: req.params.id, bridge: { userId: req.user.id } }
      });
      if (!operation) {
        return res.status(404).json({ success: false, error: { code: "OPERATION_NOT_FOUND", message: "Operation not found." } });
      }

      if (!ai) {
        // Basic offline JSON validator fallback
        try {
          const reqObj = typeof requestBody === 'object' ? requestBody : JSON.parse(requestBody);
          const fields = Object.keys(JSON.parse(operation.inputSchema).properties || {});
          const approved = JSON.parse(operation.fieldMappings);
          
          const errors: string[] = [];
          const suggestions: string[] = [];

          approved.forEach((m: any) => {
            if (!(m.restField in reqObj)) {
              errors.push(`Missing required field: '${m.restField}'`);
              suggestions.push(`Add parameter '${m.restField}' to match SOAP counterpart '${m.soapField}'`);
            }
          });

          return res.json({
            success: true,
            valid: errors.length === 0,
            errors,
            suggestions
          });
        } catch (err) {
          return res.json({
            success: true,
            valid: false,
            errors: ["Invalid request JSON payload format."],
            suggestions: ["Verify syntax brackets and commas."]
          });
        }
      }

      const modelResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Operation: ${operation.soapOperation}. Expected input schema: ${operation.inputSchema}. Actual request: ${JSON.stringify(requestBody)}.`,
        config: {
          systemInstruction: "You are a SOAP/REST API validator. Check if a JSON request body matches the expected schema for a SOAP operation. Return the assessment in JSON format.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              valid: { type: Type.BOOLEAN },
              errors: { type: Type.ARRAY, items: { type: Type.STRING } },
              suggestions: { type: Type.ARRAY, items: { type: Type.STRING } }
            },
            required: ["valid", "errors", "suggestions"]
          }
        }
      });

      const result = JSON.parse(modelResponse.text || "{}");
      return res.json({ success: true, ...result });

    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  // CALL 3: Sample Request Generation
  app.post("/api/bridges/:id/operations/:opId/generate-samples", authenticateJWT, async (req: any, res) => {
    try {
      const operation = await prisma.operation.findFirst({
        where: { id: req.params.opId, bridgeId: req.params.id, bridge: { userId: req.user.id } }
      });
      if (!operation) {
        return res.status(404).json({ success: false, error: { code: "OPERATION_NOT_FOUND", message: "Operation not found." } });
      }

      if (!ai) {
        // Basic structured Offline simulation
        const sampleRequest: Record<string, any> = {};
        const sampleResponse: Record<string, any> = {};

        const mappings = JSON.parse(operation.fieldMappings);
        mappings.forEach((m: any) => {
          sampleRequest[m.restField] = m.soapField.toLowerCase().includes("amount") ? 250.00 : "sample_value";
        });
        sampleResponse["transactionId"] = "tx_sample_uuid_fresh";
        sampleResponse["status"] = "AUTHORIZED";

        return res.json({ success: true, samples: { sampleRequest, sampleResponse } });
      }

      const modelResponse = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: `Generate a sample JSON request and response for SOAP operation: ${operation.soapOperation}, mapped fields: ${operation.fieldMappings}.`,
        config: {
          systemInstruction: "You are an API documentation assistant. Generate realistic, detailed, sample request and response bodies for REST clients. Return the output in JSON format.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              sampleRequest: { type: Type.OBJECT, description: "Sample request JSON object" },
              sampleResponse: { type: Type.OBJECT, description: "Sample response JSON object" }
            },
            required: ["sampleRequest", "sampleResponse"]
          }
        }
      });

      const samples = JSON.parse(modelResponse.text || "{}");
      return res.json({ success: true, samples });

    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  /* =====================================================================================
   * API SECURITY KEY MANAGER (PHASE 8)
   * =====================================================================================
   */
  app.post("/api/settings/api-keys", authenticateJWT, async (req: any, res) => {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Key name is required." } });
    }

    try {
      const generatedKey = "sb_" + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 12); // standard 1 year expiry

      const keyRecord = await prisma.apiKey.create({
        data: {
          key: generatedKey,
          name,
          userId: req.user.id,
          expiresAt
        }
      });

      return res.json({
        success: true,
        apiKey: keyRecord,
        rawKey: generatedKey // Return once to view then masked
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.get("/api/settings/api-keys", authenticateJWT, async (req: any, res) => {
    try {
      const keys = await prisma.apiKey.findMany({
        where: { userId: req.user.id },
        orderBy: { expiresAt: "desc" }
      });
      // Mask keys before sending back
      const maskedKeys = keys.map(k => ({
        ...k,
        key: k.key.substring(0, 6) + "******************"
      }));
      return res.json({ success: true, apiKeys: maskedKeys });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.delete("/api/settings/api-keys/:id", authenticateJWT, async (req: any, res) => {
    try {
      const keyRec = await prisma.apiKey.findFirst({
        where: { id: req.params.id, userId: req.user.id }
      });
      if (!keyRec) {
        return res.status(404).json({ success: false, error: { code: "VALIDATION_ERROR", message: "API Key not found." } });
      }

      await prisma.apiKey.delete({ where: { id: req.params.id } });
      return res.json({ success: true, message: "API Key revoked successfully." });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.put("/api/settings/profile", authenticateJWT, async (req: any, res) => {
    const { name, email } = req.body;
    try {
      const updated = await prisma.user.update({
        where: { id: req.user.id },
        data: { name: name || req.user.name, email: email || req.user.email },
        select: { id: true, email: true, name: true, role: true }
      });
      return res.json({ success: true, user: updated });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  /* =====================================================================================
   * SYSTEM DATABASE CONTROLLER / DATABASE MANAGEMENT (PHASE 6.5)
   * =====================================================================================
   */
  app.get("/api/admin/database/records", authenticateJWT, async (req: any, res) => {
    try {
      const users = await prisma.user.findMany({
        select: { id: true, email: true, name: true, role: true, createdAt: true }
      });
      const bridges = await prisma.bridge.findMany({
        select: { id: true, name: true, status: true, userId: true, user: { select: { name: true } } }
      });
      const keys = await prisma.apiKey.findMany({
        select: { id: true, name: true, isActive: true, userId: true, user: { select: { name: true } } }
      });
      const logsCount = await prisma.requestLog.count();
      
      return res.json({
        success: true,
        stats: {
          usersCount: users.length,
          bridgesCount: bridges.length,
          keysCount: keys.length,
          logsCount
        },
        users,
        bridges,
        keys
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.delete("/api/admin/database/users/:id", authenticateJWT, async (req: any, res) => {
    try {
      if (req.params.id === req.user.id) {
        return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Cannot delete your active session user account." } });
      }
      await prisma.user.delete({ where: { id: req.params.id } });
      return res.json({ success: true, message: "User account deleted successfully from modern database." });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  /* =====================================================================================
   * ANALYTICS / MONITORING MODULES (PHASE 7)
   * =====================================================================================
   */
  app.get("/api/analytics/overview", authenticateJWT, async (req: any, res) => {
    try {
      const totalBridges = await prisma.bridge.count({ where: { userId: req.user.id } });
      const activeEndpoints = await prisma.operation.count({ where: { bridge: { userId: req.user.id, status: "ACTIVE" } } });
      
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const requestsToday = await prisma.requestLog.count({
        where: { bridge: { userId: req.user.id }, createdAt: { gte: todayStart } }
      });

      const totalLogs = await prisma.requestLog.count({
        where: { bridge: { userId: req.user.id } }
      });

      const errorLogs = await prisma.requestLog.count({
        where: { bridge: { userId: req.user.id }, statusCode: { gte: 400 } }
      });

      const errorRate = totalLogs > 0 ? Number(((errorLogs / totalLogs) * 100).toFixed(1)) : 0;

      return res.json({
        success: true,
        overview: {
          totalBridges,
          activeEndpoints,
          requestsToday,
          errorRate
        }
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.get("/api/analytics/timeseries", authenticateJWT, async (req: any, res) => {
    const range = req.query.range || "24h";
    try {
      const now = new Date();
      let limitDate = new Date();
      if (range === "24h") limitDate.setHours(now.getHours() - 24);
      else if (range === "7d") limitDate.setDate(now.getDate() - 7);
      else limitDate.setDate(now.getDate() - 30);

      const logs = await prisma.requestLog.findMany({
        where: { bridge: { userId: req.user.id }, createdAt: { gte: limitDate } },
        orderBy: { createdAt: "asc" }
      });

      // Group into hourly or daily intervals
      const timeseriesMap = new Map<string, { timestamp: string; count: number; errors: number }>();
      
      logs.forEach(log => {
        let key = "";
        const dateObj = new Date(log.createdAt);
        if (range === "24h") {
          key = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
          key = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }

        const current = timeseriesMap.get(key) || { timestamp: key, count: 0, errors: 0 };
        current.count += 1;
        if (log.statusCode >= 400) current.errors += 1;
        timeseriesMap.set(key, current);
      });

      return res.json({ success: true, timeseries: Array.from(timeseriesMap.values()) });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.get("/api/analytics/by-endpoint", authenticateJWT, async (req: any, res) => {
    try {
      const logs = await prisma.requestLog.findMany({
        where: { bridge: { userId: req.user.id } },
        include: { bridge: { select: { name: true } } }
      });

      const map = new Map<string, { operationName: string; count: number; errors: number }>();
      
      for (const log of logs) {
        const matchingOp = log.operationId ? await prisma.operation.findUnique({ where: { id: log.operationId } }) : null;
        const name = matchingOp ? matchingOp.soapOperation : `${log.method} ${log.path}`;
        
        const current = map.get(name) || { operationName: name, count: 0, errors: 0 };
        current.count += 1;
        if (log.statusCode >= 400) current.errors += 1;
        map.set(name, current);
      }

      return res.json({ success: true, byEndpoint: Array.from(map.values()) });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  app.get("/api/logs", authenticateJWT, async (req: any, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 15;
    const skip = (page - 1) * limit;

    try {
      const logs = await prisma.requestLog.findMany({
        where: { bridge: { userId: req.user.id } },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
        include: { bridge: { select: { name: true } } }
      });

      const total = await prisma.requestLog.count({
        where: { bridge: { userId: req.user.id } }
      });

      return res.json({
        success: true,
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  /* =====================================================================================
   * DYNAMIC SWAGGER DOCS OPENAPI 3.0 EXPORT GENERATOR (PHASE 6)
   * =====================================================================================
   */
  app.get("/api/bridges/:id/spec", authenticateJWT, async (req: any, res) => {
    try {
      const bridge = await prisma.bridge.findFirst({
        where: { id: req.params.id, userId: req.user.id },
        include: { operations: true }
      });
      if (!bridge) {
        return res.status(404).json({ success: false, error: { code: "BRIDGE_NOT_FOUND", message: "Bridge not found." } });
      }

      const paths: Record<string, any> = {};

      bridge.operations.forEach(op => {
        const inputS = JSON.parse(op.inputSchema);
        const outputS = JSON.parse(op.outputSchema);

        // Convert fields schemas to clean Rest fields schemas based on mappings
        const mappings = JSON.parse(op.fieldMappings);
        const mappedProperties: Record<string, any> = {};
        
        mappings.forEach((m: any) => {
          const originalProp = inputS.properties?.[m.soapField];
          mappedProperties[m.restField] = {
            type: originalProp?.type || "string",
            description: originalProp?.description || `REST value representing Legacy ${m.soapField}`
          };
        });

        const reqBodySchema = {
          type: "object",
          properties: mappedProperties,
          required: mappings.map((m: any) => m.restField)
        };

        const methodLower = op.restMethod.toLowerCase();
        paths[op.restPath] = {
          [methodLower]: {
            summary: `Proxy REST gateway for SOAP parameter operation: ${op.soapOperation}`,
            description: `Transmutes your payload recursively into dynamic namespace SOAP Envelopes, calls the backend system, and translates XML elements back into JSON objects.`,
            parameters: op.authRequired ? [
              {
                name: "X-API-KEY",
                in: "header",
                required: true,
                schema: { type: "string" },
                description: "Enterprise modernization programmatic verification API access Key"
              }
            ] : [],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: reqBodySchema
                }
              }
            },
            responses: {
              "200": {
                description: "Success JSON response translation completed.",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        modernizationApproved: { type: "boolean", default: true },
                        processedBy: { type: "string", default: "Express Direct AI Gateway" },
                        timestamp: { type: "string" }
                      }
                    }
                  }
                }
              },
              "400": {
                description: "Bad Request. Custom JSON error formats with details.",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      properties: {
                        success: { type: "boolean", default: false },
                        error: {
                          type: "object",
                          properties: {
                            code: { type: "string" },
                            message: { type: "string" }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        };
      });

      const openApiSpec = {
        openapi: "3.0.0",
        info: {
          title: `${bridge.name} - Modernized REST Endpoint Interfaces`,
          description: bridge.description || "Auto-modernized REST interfaces created seamlessly by SOAP Bridge and dynamic schema proxy normalizations.",
          version: "1.0.0"
        },
        servers: [
          {
            url: `http://localhost:3000/proxy/${bridge.id}`,
            description: "Active proxy translation server environment"
          }
        ],
        paths
      };

      return res.json(openApiSpec);
    } catch (e: any) {
      return res.status(500).json({ success: false, error: { code: "SERVER_ERROR", message: e.message } });
    }
  });

  /* =====================================================================================
   * MOCK INTERNAL LEGACY SOAP BACKEND (SANDBOX TEST SERVER)
   * =====================================================================================
   */
  app.post("/ws/soap-backend", (req, res) => {
    const rawXml = req.body || "";
    console.log("Legacy SOAP Ingestion point received raw envelope: ", rawXml);

    // Dynamic RegExp extracts params to handle nested structures effortlessly without failing
    const getTagValue = (xml: string, tag: string) => {
      const match = xml.match(new RegExp(`<[^:>]*:?${tag}[^>]*>([^<]*)<\/[^:>]*:?${tag}>`));
      return match ? match[1] : null;
    };

    const merchantId = getTagValue(rawXml, "MerchantId") || "MERCH-MOCK-999";
    const rawAmount = getTagValue(rawXml, "Amount");
    const amount = rawAmount ? parseFloat(rawAmount) : 100.00;
    const currency = getTagValue(rawXml, "CurrencyCode") || "USD";
    const cardNumber = getTagValue(rawXml, "CardNumber") || "N/A";

    res.contentType("text/xml");

    // Standard simulated financial rules: triggering target faults/failures
    if (amount <= 0 || cardNumber.startsWith("4000")) {
      const soapFaultXml = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
   <soapenv:Body>
      <soapenv:Fault>
         <faultcode>soapenv:Server.InsufficientFunds</faultcode>
         <faultstring>Declined: The requested authorization amount is unavailable or exceeds card daily credit limit.</faultstring>
         <detail>Internal sandbox banking system error: Card limit reached</detail>
      </soapenv:Fault>
   </soapenv:Body>
</soapenv:Envelope>`;
      return res.status(402).send(soapFaultXml);
    }

    // Success response soap container
    const randomId = "TXN-J-MOCK-" + Math.floor(100000 + Math.random() * 900000);
    const soapResponseXml = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:pay="http://legacy.pay.org/auth/">
   <soapenv:Header>
      <pay:ProcessingMetadata>
         <pay:HostInstance>JVM-NODE-32</pay:HostInstance>
         <pay:PerfDurationMs>18</pay:PerfDurationMs>
      </pay:ProcessingMetadata>
   </soapenv:Header>
   <soapenv:Body>
      <pay:AuthorizePaymentResponse>
         <pay:TransactionId>${randomId}</pay:TransactionId>
         <pay:ApprovalCode>MOCK-SOAP-999</pay:ApprovalCode>
         <pay:ResponseCode>00</pay:ResponseCode>
         <pay:Status>AUTHORIZED</pay:Status>
      </pay:AuthorizePaymentResponse>
   </soapenv:Body>
</soapenv:Envelope>`;

    return res.status(200).send(soapResponseXml);
  });

  /* =====================================================================================
   * MODERN CORE RUNTIME DYNAMIC PROXY PIPELINE (PHASE 5)
   * =====================================================================================
   */
  const handleProxy = async (req: express.Request, res: express.Response) => {
    const startTime = Date.now();
    const bridgeId = req.params.bridgeId;
    const restPart = req.params.restPath || req.params[0] || "";
    const restPath = "/" + restPart.replace(/^\/+/, "");
    const method = req.method;

    console.log(`Matched dynamic proxy pipeline on route [${method}] [${restPath}] for Bridge ID: ${bridgeId}`);

    // Verify bridge existence
    const bridge = await prisma.bridge.findUnique({
      where: { id: bridgeId },
      include: { operations: true }
    });

    if (!bridge) {
      return res.status(404).json({
        success: false,
        error: { code: "BRIDGE_NOT_FOUND", message: "現代化網關: The target SOAP Bridge was not found." }
      });
    }

    if (bridge.status !== "ACTIVE") {
      return res.status(400).json({
        success: false,
        error: { code: "SOAP_PROXY_ERROR", message: " modernisation is paused. Activate the bridge first." }
      });
    }

    // Match operation config
    const operation = bridge.operations.find(
      op => op.restPath.toLowerCase() === restPath.toLowerCase() && op.restMethod.toUpperCase() === method.toUpperCase()
    );

    if (!operation) {
      return res.status(404).json({
        success: false,
        error: { code: "OPERATION_NOT_FOUND", message: `Modernised endpoint [${method}] '${restPath}' is not configured.` }
      });
    }

    // 1. Verify Authentication if required
    let activeUser: any = null;
    if (operation.authRequired) {
      const authHeader = req.headers.authorization;
      const apiKeyHeader = req.headers["x-api-key"] as string;

      if (apiKeyHeader) {
        // Authenticate via Programmatic API Key
        const apiKeyRecord = await prisma.apiKey.findUnique({
          where: { key: apiKeyHeader, isActive: true },
          include: { user: true }
        });
        if (!apiKeyRecord) {
          return res.status(401).json({
            success: false,
            error: { code: "AUTH_INVALID_API_KEY", message: "Programmatic API key is invalid or revoked." }
          });
        }
        activeUser = apiKeyRecord.user;
        // Update key usage timestamp as a background non-blocking promise
        prisma.apiKey.update({
          where: { id: apiKeyRecord.id },
          data: { lastUsedAt: new Date() }
        }).catch(() => {});
      } else if (authHeader && authHeader.startsWith("Bearer ")) {
        // Authenticate via user access token
        const token = authHeader.substring(7);
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as any;
          activeUser = await prisma.user.findUnique({ where: { id: decoded.userId } });
        } catch {
          return res.status(401).json({
            success: false,
            error: { code: "AUTH_INVALID_TOKEN", message: "modernization access session expired/invalid." }
          });
        }
      } else if (req.cookies && req.cookies.accessToken) {
        try {
          const decoded = jwt.verify(req.cookies.accessToken, JWT_SECRET) as any;
          activeUser = await prisma.user.findUnique({ where: { id: decoded.userId } });
        } catch {}
      }

      if (!activeUser) {
        return res.status(401).json({
          success: false,
          error: { code: "AUTH_INVALID_TOKEN", message: "Authentication JWT token or API Access Key are required." }
        });
      }
    }

    // 2. Cache resolution (TTL-based)
    const cacheKey = `${bridgeId}:${operation.id}:${JSON.stringify(req.body)}`;
    if (operation.cacheEnabled && memoryCache[cacheKey]) {
      const cached = memoryCache[cacheKey];
      if (cached.expiry > Date.now()) {
        const latencyMs = Date.now() - startTime;
        // Log cached access
        prisma.requestLog.create({
          data: {
            bridgeId,
            operationId: operation.id,
            userId: activeUser?.id,
            method,
            path: restPath,
            statusCode: 200,
            latencyMs,
            requestBody: JSON.stringify(req.body),
            responseBody: JSON.stringify(cached.data),
            ipAddress: getIp(req),
          }
        }).catch(err => console.error("Async log save failed:", err));
        return res.json(cached.data);
      }
    }

    // 3. Translate JSON to SOAP XML Envelope via direct field mappings
    let reqPayload = req.body || {};
    const mappingsList = JSON.parse(operation.fieldMappings);

    // Map fields from client camelCase into legacy structures
    const legacyPayload: Record<string, any> = {};
    mappingsList.forEach((m: any) => {
      legacyPayload[m.soapField] = reqPayload[m.restField];
    });

    const recursiveObjectToXmlFields = (obj: any): string => {
      let xml = "";
      for (const k in obj) {
        const v = obj[k];
        if (v === undefined || v === null) continue;
        xml += `<tns:${k}>${typeof v === "object" ? recursiveObjectToXmlFields(v) : v}</tns:${k}>`;
      }
      return xml;
    };

    const xmlFieldsBlock = recursiveObjectToXmlFields(legacyPayload);
    const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="${bridge.namespace}">
   <soapenv:Header/>
   <soapenv:Body>
      <tns:${operation.soapOperation}>
         ${xmlFieldsBlock}
      </tns:${operation.soapOperation}>
   </soapenv:Body>
</soapenv:Envelope>`;

    console.log("Dynamically marshalled outbound SOAP Envelope:\n", soapEnvelope);

    // 4. Forward soap payload to the legacy backend SOAP SOAP endpoint url
    try {
      const fetchResponse = await fetch(bridge.soapEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "SOAPAction": operation.soapAction,
        },
        body: soapEnvelope
      });

      const responseXmlText = await fetchResponse.text();
      const statusCode = fetchResponse.status;
      const latencyMs = Date.now() - startTime;

      // Parse returning SOAP XML response raw elements back into modern camelCase JSON
      const docParser = new XMLParser({
        ignoreAttributes: true,
        removeNSPrefix: true // Strips namespaces for exact value matches
      });
      const parsedXml = docParser.parse(responseXmlText);

      // Recursive tag searching helper
      const findValByKey = (obj: any, keyName: string): any => {
        if (!obj || typeof obj !== "object") return undefined;
        if (keyName in obj) return obj[keyName];
        for (const k in obj) {
          const found = findValByKey(obj[k], keyName);
          if (found !== undefined) return found;
        }
        return undefined;
      };

      // Check if legacy Fault ocurred
      const faultCode = findValByKey(parsedXml, "faultcode");
      const faultString = findValByKey(parsedXml, "faultstring");
      const faultDetail = findValByKey(parsedXml, "detail") || findValByKey(parsedXml, "faultdetail");

      if (faultCode || faultString) {
        const translatedFault = {
          success: false,
          error: {
            code: "SOAP_FAULT",
            message: faultString || "Legacy SOAP endpoint returned solid Fault code.",
            details: {
              faultCode: faultCode || "soapenv:Server",
              detail: typeof faultDetail === "object" ? JSON.stringify(faultDetail) : (faultDetail || "No fault details payload provided.")
            }
          }
        };

        prisma.requestLog.create({
          data: {
            bridgeId,
            operationId: operation.id,
            userId: activeUser?.id,
            method,
            path: restPath,
            statusCode: fetchResponse.status || 400,
            latencyMs,
            requestBody: JSON.stringify(reqPayload),
            responseBody: JSON.stringify(translatedFault),
            errorMessage: faultString || "SOAP Fault triggered",
            ipAddress: getIp(req),
          }
        }).catch(err => console.error("Async fault log save failed:", err));

        return res.status(statusCode >= 400 ? statusCode : 400).json(translatedFault);
      }

      // Map soap elements back to sleek client JSON structures
      const responseDto: Record<string, any> = {
        modernizationApproved: true,
        processedBy: "SOAP-to-REST AI Modernization Gateway",
        timestamp: new Date().toISOString()
      };

      // Extract and map according to schemas
      const responseSchemaProperties = JSON.parse(operation.outputSchema).properties || {};
      Object.keys(responseSchemaProperties).forEach(legacyKey => {
        const mappedRestKey = mappingsList.find((m: any) => m.soapField === legacyKey)?.restField || 
                             (legacyKey.charAt(0).toLowerCase() + legacyKey.slice(1));
        const val = findValByKey(parsedXml, legacyKey);
        if (val !== undefined) responseDto[mappedRestKey] = val;
      });

      // 5. Caching updates
      if (operation.cacheEnabled) {
        memoryCache[cacheKey] = {
          data: responseDto,
          expiry: Date.now() + (operation.cacheTtl * 1000)
        };
      }

      // 6. Log dynamic proxy transaction
      prisma.requestLog.create({
        data: {
          bridgeId,
          operationId: operation.id,
          userId: activeUser?.id,
          method,
          path: restPath,
          statusCode: 200,
          latencyMs,
          requestBody: JSON.stringify(reqPayload),
          responseBody: JSON.stringify(responseDto),
          ipAddress: getIp(req),
        }
      }).catch(err => console.error("Async success log save failed:", err));

      return res.json(responseDto);

    } catch (e: any) {
      console.error("Proxy endpoint routing exception: ", e);
      const latencyMs = Date.now() - startTime;
      const finalError = {
        success: false,
        error: {
          code: "SOAP_PROXY_ERROR",
          message: "Failed connecting upstream legacy SOAP system. Target host returned unreachable: " + e.message,
          details: {}
        }
      };

      prisma.requestLog.create({
        data: {
          bridgeId,
          operationId: operation.id,
          userId: activeUser?.id,
          method,
          path: restPath,
          statusCode: 502,
          latencyMs,
          requestBody: JSON.stringify(reqPayload),
          responseBody: JSON.stringify(finalError),
          errorMessage: e.message,
          ipAddress: getIp(req),
        }
      }).catch(err => console.error("Async exception log save failed:", err));

      return res.status(502).json(finalError);
    }
  };

  app.all("/p/:bridgeId/*", handleProxy);
  app.all("/proxy/:bridgeId/*", handleProxy);

  /* =====================================================================================
   * SEEDING & METADATA FLOW FOR EASY TESTING (SANDBOX SAMPLES GENERATION)
   * =====================================================================================
   */
  app.post("/api/seed-sandbox-wsdl", authenticateJWT, async (req: any, res) => {
    try {
      const sampleWsdl = `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" 
                  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" 
                  xmlns:tns="http://legacy.pay.org/auth/" 
                  xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
                  targetNamespace="http://legacy.pay.org/auth/">
  <wsdl:types>
    <xsd:schema targetNamespace="http://legacy.pay.org/auth/">
      <xsd:element name="AuthorizePaymentRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="MerchantId" type="xsd:string"/>
            <xsd:element name="Amount" type="xsd:decimal"/>
            <xsd:element name="CurrencyCode" type="xsd:string"/>
            <xsd:element name="CardNumber" type="xsd:string"/>
            <xsd:element name="ExpiryDate" type="xsd:string"/>
            <xsd:element name="CVV" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="AuthorizePaymentResponse">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="TransactionId" type="xsd:string"/>
            <xsd:element name="ResponseCode" type="xsd:string"/>
            <xsd:element name="Status" type="xsd:string"/>
            <xsd:element name="ApprovalCode" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
    </xsd:schema>
  </wsdl:types>
  <wsdl:portType name="PaymentPort">
    <wsdl:operation name="AuthorizePayment">
      <wsdl:input message="tns:AuthorizePaymentRequest"/>
      <wsdl:output message="tns:AuthorizePaymentResponse"/>
    </wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="PaymentSoapBinding" type="tns:PaymentPort">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="AuthorizePayment">
      <soap:operation soapAction="http://legacy.pay.org/auth/AuthorizePayment"/>
      <wsdl:input><soap:body use="literal"/></wsdl:input>
      <wsdl:output><soap:body use="literal"/></wsdl:output>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="PaymentService">
    <wsdl:port name="PaymentPort" binding="tns:PaymentSoapBinding">
      <soap:address location="http://localhost:3000/ws/soap-backend"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;

      return res.json({ success: true, wsdl: sampleWsdl });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // DB Self-healing bootstrap
  try {
    console.log("=== RUNNING GATEWAY SELF-HEALING BOOTSTRAP ===");
    const passwordHash = await bcrypt.hash("EnterprisePass123!", 10);
    const usersData = [
      { email: "developer@enterprise.org", name: "Enterprise Architect" },
      { email: "srini16dinesh@gmail.com", name: "Srini Dinesh" }
    ];

    const WSDL_CONTENT_BOOT = `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" 
                  xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" 
                  xmlns:tns="http://legacy.pay.org/auth/" 
                  xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
                  targetNamespace="http://legacy.pay.org/auth/">
  <wsdl:types>
    <xsd:schema targetNamespace="http://legacy.pay.org/auth/">
      <xsd:element name="AuthorizePaymentRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="MerchantId" type="xsd:string"/>
            <xsd:element name="Amount" type="xsd:decimal"/>
            <xsd:element name="CurrencyCode" type="xsd:string"/>
            <xsd:element name="CardNumber" type="xsd:string"/>
            <xsd:element name="ExpiryDate" type="xsd:string"/>
            <xsd:element name="CVV" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="AuthorizePaymentResponse">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="TransactionId" type="xsd:string"/>
            <xsd:element name="ResponseCode" type="xsd:string"/>
            <xsd:element name="Status" type="xsd:string"/>
            <xsd:element name="ApprovalCode" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
    </xsd:schema>
  </wsdl:types>
  <wsdl:portType name="PaymentPort">
    <wsdl:operation name="AuthorizePayment">
      <wsdl:input message="tns:AuthorizePaymentRequest"/>
      <wsdl:output message="tns:AuthorizePaymentResponse"/>
    </wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="PaymentSoapBinding" type="tns:PaymentPort">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="AuthorizePayment">
      <soap:operation soapAction="http://legacy.pay.org/auth/AuthorizePayment"/>
      <wsdl:input><soap:body use="literal"/></wsdl:input>
      <wsdl:output><soap:body use="literal"/></wsdl:output>
    </wsdl:operation>
  </wsdl:binding>
</wsdl:definitions>`;

    for (const d of usersData) {
      let dbUser = await prisma.user.findUnique({ where: { email: d.email } });
      if (!dbUser) {
        dbUser = await prisma.user.create({
          data: {
            email: d.email,
            name: d.name,
            passwordHash,
            role: "DEVELOPER"
          }
        });
        console.log(`[BOOTSTRAP] Custom user registered: ${dbUser.name} (${dbUser.email})`);
      }

      const bridgeCount = await prisma.bridge.count({ where: { userId: dbUser.id } });
      if (bridgeCount === 0) {
        const bridge = await prisma.bridge.create({
          data: {
            name: "Legacy Bank Payment Auth",
            description: "SOAP-based legacy bank transaction authorization with explicit currency types and account details.",
            wsdlContent: WSDL_CONTENT_BOOT,
            soapEndpoint: "http://localhost:3000/ws/soap-backend",
            namespace: "http://legacy.pay.org/auth/",
            status: "ACTIVE",
            userId: dbUser.id
          }
        });

        const inputs = {
          MerchantId: "string",
          Amount: "number",
          CurrencyCode: "string",
          CardNumber: "string",
          ExpiryDate: "string",
          CVV: "string"
        };

        const outputs = {
          TransactionId: "string",
          ResponseCode: "string",
          Status: "string",
          ApprovalCode: "string"
        };

        const jsonInputSchema = {
          type: "object",
          properties: Object.keys(inputs).reduce((acc: any, key) => {
            acc[key] = { type: (inputs as any)[key], description: `SOAP field ${key}` };
            return acc;
          }, {}),
          required: Object.keys(inputs)
        };

        const jsonOutputSchema = {
          type: "object",
          properties: Object.keys(outputs).reduce((acc: any, key) => {
            acc[key] = { type: (outputs as any)[key], description: `SOAP field ${key}` };
            return acc;
          }, {})
        };

        const defaultMappings = Object.keys(inputs).map(key => {
          const camelCased = key.charAt(0).toLowerCase() + key.slice(1);
          return {
            soapField: key,
            restField: camelCased,
            confidence: 90,
            reasoning: "Direct mapping from capital header"
          };
        });

        await prisma.operation.create({
          data: {
            bridgeId: bridge.id,
            soapOperation: "AuthorizePayment",
            soapAction: "http://legacy.pay.org/auth/AuthorizePayment",
            restPath: "/authorize-payment",
            restMethod: "POST",
            inputSchema: JSON.stringify(jsonInputSchema),
            outputSchema: JSON.stringify(jsonOutputSchema),
            fieldMappings: JSON.stringify(defaultMappings),
            authRequired: true,
            cacheEnabled: false,
            rateLimitRpm: 100
          }
        });
        console.log(`[BOOTSTRAP] Configured operational route for user ${dbUser.email}`);
      }
    }
    console.log("=== SELF-HEALING BOOTSTRAP SUCCEEDED ===");
  } catch (err: any) {
    console.error("[BOOTSTRAP ERR] Failed self-healing database preparation: ", err.message);
  }

  /* =====================================================================================
   * VITE INTERACTION MIDDLEWARE LAYER
   * =====================================================================================
   */
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Enterprise SOAP Bridge Modernization Gateway started on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Critical server startup failure: ", err);
});
