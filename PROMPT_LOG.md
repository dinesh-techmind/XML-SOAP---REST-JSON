# Developer Prompt Log: Spring Boot XML/SOAP to REST/JSON Bridge with Spring Security

This log catalogs the prompt definitions and target architectural patterns for converting legacy SOAP/WSDL contracts into secure, modern REST services using Java 21, Spring Boot 3.x, and Spring Security 6.x.

## Phase 1 Prompt: Spec-Driven Spring Boot REST/JSON Generator & Spring Security

```markdown
Generate a high-performance, secure, and production-grade XML/SOAP to REST/JSON proxy translation service using Java 21, Spring Boot 3.x, and Spring Security 6.x:
The code must fulfill the following architectural requirements:

1. REST TO SOAP MAPPING (JAXB & Jackson):
   - Accept JSON requests validated via Spring validation constraints (`@Valid`, Lombok/Jackson DTOs).
   - Use JAXB marshallers (`jakarta.xml.bind.Marshaller`) to convert Java DTOs into well-formed SOAP Envelopes with exact legacy namespaces.

2. SPRING SECURITY FILTER CHAIN:
   - Configure a secure `SecurityFilterChain` bean.
   - Enforce authentication via JWT token verification or API Key validation headers.
   - Restrict bridge endpoints using exact scope roles (e.g., `.requestMatchers("/api/v1/payments/**").hasRole("PAYMENT_SERVICE")`).
   - Prevent unauthorized calls before reaching the translation middleware.

3. OUTGOING SOAP GATEWAY:
   - Dispatch POST requests using `RestTemplate` or `WebClient` to legacy internal endpoints.
   - Inject required headers (`SOAPAction`, `Content-Type: text/xml; charset=utf-8`).

4. EXCEPTION MAPPING & SOAP FAULT TRANSLATOR:
   - Read SOAP Exception faults (`<soapenv:Fault>`) gracefully.
   - Parse `<faultcode>` and `<faultstring>` dynamically using standard XML Document Builders (`javax.xml.parsers.DocumentBuilderFactory`).
   - Construct a global `@RestControllerAdvice` to translate legacy fault codes to standard HTTP exception codes:
     - `soapenv:Client.AuthenticationFailed` -> 401 Unauthorized
     - `soapenv:Server.InsufficientFunds` -> 402 Payment Required
     - `soapenv:Client.InvalidRequest` -> 400 Bad Request

5. PERSISTENT TRANSACTION TRANSACTION LOGGER (Spring Data JPA):
   - Use JPA `@Entity` to represent translation transaction states.
   - Persist logs (endpoint name, client info, SOAP action status, HTTP status codes, timestamps) to an H2/PostgreSQL database via a simple Spring Data `JpaRepository`.

Ensure all source files are fully self-contained, typed correctly, using Lombok annotations and spring security patterns. Include complete configurations. Do not write dummy snippets.
```

---

## Phase 2 Prompt: Agentic JVM Validation & Self-Correcting Compilation Loop

```markdown
Build a continuous self-correcting JVM agent loop for verifying JAXB / Jackson translation mappers against input WSDL parameters:

1. INTROSPECT AND GENERATE POJOs:
   - Agent parses incoming WSDL and compiles relevant JAXB classes (`xjc`) or Spring POJO entities.

2. EXECUTE THE ASSERTION suite (JUnit 5):
   - Execute test cases where test JSON payloads are converted, marshalled, and compared to legacy SOAP schemas.
   - Verify that generated entities strict field structures match legacy constraints.

3. JVM REPAIR STRATEGY:
   - If JAXB class compilation or JUnit assertions fail (e.g. namespace clash, missing attribute setter, validation error), capture the compiler trace.
   - Wrap the full compilation traceback inside the class context and hand it back to the generative model.
   - The loop must self-correct until all JUnit mappers pass without errors.
```
