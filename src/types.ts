export enum Role {
  ADMIN = "ADMIN",
  DEVELOPER = "DEVELOPER",
}

export enum BridgeStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  DRAFT = "DRAFT",
}

export enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  DELETE = "DELETE",
  PATCH = "PATCH",
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role | string;
  createdAt: string;
  updatedAt: string;
}

export interface Bridge {
  id: string;
  name: string;
  description?: string;
  wsdlContent: string;
  wsdlUrl?: string;
  soapEndpoint: string;
  namespace: string;
  status: BridgeStatus | string;
  userId: string;
  operations?: Operation[];
  logs?: RequestLog[];
}

export interface FieldMapping {
  soapField: string;
  restField: string;
  confidence: number; // 0 - 100
  reasoning: string;
}

export interface Operation {
  id: string;
  bridgeId: string;
  soapAction: string;
  soapOperation: string;
  restPath: string;
  restMethod: HttpMethod | string;
  inputSchema: string; // JSON schema as string
  outputSchema: string; // JSON schema as string
  fieldMappings: string; // List of FieldMapping stringified
  authRequired: boolean;
  cacheEnabled: boolean;
  cacheTtl: number;
  rateLimitRpm: number;
}

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  userId: string;
  lastUsedAt?: string;
  expiresAt?: string;
  isActive: boolean;
}

export interface RequestLog {
  id: string;
  bridgeId: string;
  operationId?: string;
  userId?: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  requestBody?: string;
  responseBody?: string;
  errorMessage?: string;
  ipAddress: string;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface AnalyticsOverview {
  totalBridges: number;
  activeEndpoints: number;
  requestsToday: number;
  errorRate: number; // percentage
}

export interface AnalyticsTimeseries {
  timestamp: string;
  count: number;
  errors: number;
}

export interface AnalyticsByEndpoint {
  operationName: string;
  count: number;
  errors: number;
}
