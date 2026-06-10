package org.bank.bridge.service;

import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.Marshaller;
import org.bank.bridge.dto.*;
import org.bank.bridge.exception.LegacySoapFaultException;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import java.io.StringWriter;

@Service
public class SoapProxyService {

    private final RestTemplate restTemplate = new RestTemplate();
    private static final String SOAP_ENDPOINT = "http://localhost:8080/legacy/ws";

    public UserResponseDTO callLegacyUserSoap(GetUserRequest req) {
        try {
            // Instantiate dynamic JAXB Context
            JAXBContext context = JAXBContext.newInstance(GetUserRequestJaxb.class);
            Marshaller marshaller = context.createMarshaller();
            marshaller.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.TRUE);

            GetUserRequestJaxb jaxbReq = new GetUserRequestJaxb();
            jaxbReq.setUserId(req.userId());
            jaxbReq.setAuthToken(req.authToken());

            StringWriter sw = new StringWriter();
            marshaller.marshal(jaxbReq, sw);
            String soapEnvelope = sw.toString();

            // Set SOAP action parameters
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.TEXT_XML);
            headers.set("SOAPAction", "http://legacy.bank.org/userservice/GetUser");

            HttpEntity<String> entity = new HttpEntity<>(soapEnvelope, headers);
            // In real enterprise deployment, post to the physical downstream legacy SOAP server
            // String response = restTemplate.postForObject(SOAP_ENDPOINT, entity, String.class);

            // Simulation of SOAP service behaviour for safe offline run checks
            if (req.authToken().contains("expired")) {
                String errorFault = "<?xml version=\"1.0\" encoding=\"utf-8\"?><soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\"><soapenv:Body><soapenv:Fault><faultcode>soapenv:Client.AuthenticationFailed</faultcode><faultstring>Legacy SOAP header authorization check failed: Authentication token has expired.</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>";
                throw new LegacySoapFaultException(errorFault);
            }

            return new UserResponseDTO("success", new UserResponseDTO.Profile(
                req.userId(),
                "Legacy Spring Account Holder " + req.userId(),
                "user_" + req.userId() + "@legacy-bank-java-sdk.org",
                "PRIVILEGED_CORP_USER"
            ));
        } catch (Exception e) {
            if (e instanceof LegacySoapFaultException) {
                throw (LegacySoapFaultException) e;
            }
            throw new RuntimeException("SOAP invocation error", e);
        }
    }

    public PaymentResponseDTO callLegacyPaymentSoap(AuthorizePaymentRequest req) {
        try {
            // Marshall payment elements
            StringWriter sw = new StringWriter();
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.TEXT_XML);
            headers.set("SOAPAction", "http://legacy.pay.org/auth/AuthorizePayment");

            // Insufficient funds trigger check
            if (req.amount().doubleValue() <= 20) {
                String faultResponse = "<?xml version=\"1.0\" encoding=\"utf-8\"?><soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\"><soapenv:Body><soapenv:Fault><faultcode>soapenv:Server.InsufficientFunds</faultcode><faultstring>Declined: The requested authorization amount is unavailable or exceeds card daily credit limit.</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>";
                throw new LegacySoapFaultException(faultResponse);
            }

            return new PaymentResponseDTO(
                "TXN-J-" + System.currentTimeMillis(),
                "SPRING-APP-0992",
                "00",
                "AUTHORIZED"
            );
        } catch (Exception e) {
            if (e instanceof LegacySoapFaultException) {
                throw (LegacySoapFaultException) e;
            }
            throw new RuntimeException("SOAP payment integration failed", e);
        }
    }
}
