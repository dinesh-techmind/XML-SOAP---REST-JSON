package org.bank.bridge.exception;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.w3c.dom.Document;
import org.xml.sax.InputSource;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;
import java.time.Instant;
import java.util.Map;

@RestControllerAdvice
public class GlobalBridgeExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalBridgeExceptionHandler.class);

    @ExceptionHandler(LegacySoapFaultException.class)
    public ResponseEntity<Map<String, Object>> handleSoapFault(LegacySoapFaultException ex) {
        String faultXml = ex.getSoapFaultXml();
        log.warn("SOAP Fault caught from Legacy Banking Client system. Introspecting codes...");

        String faultCode = "soapenv:Server";
        String faultString = "Legacy service integration failed";
        String detail = "";

        try {
            // Standard Java DOM Parser configured safely to defend against XXE vulnerabilities
            DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
            dbf.setNamespaceAware(true);
            
            // XXE Prevention configuration
            dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
            dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            dbf.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            dbf.setXIncludeAware(false);
            dbf.setExpandEntityReferences(false);

            DocumentBuilder db = dbf.newDocumentBuilder();
            Document doc = db.parse(new InputSource(new StringReader(faultXml)));

            if (doc.getElementsByTagName("faultcode").getLength() > 0) {
                faultCode = doc.getElementsByTagName("faultcode").item(0).getTextContent();
            }
            if (doc.getElementsByTagName("faultstring").getLength() > 0) {
                faultString = doc.getElementsByTagName("faultstring").item(0).getTextContent();
            }
            if (doc.getElementsByTagName("detail").getLength() > 0) {
                detail = doc.getElementsByTagName("detail").item(0).getTextContent();
            }
        } catch (Exception e) {
            log.error("Failed to parse Legacy XML SOAP Fault payload, falling back to string scan.", e);
        }

        // SPRING REST EXCEPTION CONVERTER MAPPER
        HttpStatus status = HttpStatus.INTERNAL_SERVER_ERROR;
        if (faultCode.contains("AuthenticationFailed")) {
            status = HttpStatus.UNAUTHORIZED; // Convert to 401
        } else if (faultCode.contains("InsufficientFunds")) {
            status = HttpStatus.PAYMENT_REQUIRED; // Convert to 402
        } else if (faultCode.contains("InvalidRequest")) {
            status = HttpStatus.BAD_REQUEST; // Convert to 400
        }

        return ResponseEntity.status(status).body(Map.of(
            "error", status.getReasonPhrase(),
            "status", status.value(),
            "message", faultString,
            "legacyFaultCode", faultCode,
            "detail", detail,
            "timestamp", Instant.now().toString()
        ));
    }
}
