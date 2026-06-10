package org.bank.bridge.controller;
import jakarta.validation.Valid;
import org.bank.bridge.dto.*;
import org.bank.bridge.service.SoapProxyService;
import org.bank.bridge.entity.ProxyTransactionLog;
import org.bank.bridge.repository.ProxyLogRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class SoapBridgeController {
    
    private static final Logger log = LoggerFactory.getLogger(SoapBridgeController.class);
    private final SoapProxyService proxyService;
    private final ProxyLogRepository logRepository;

    public SoapBridgeController(SoapProxyService proxyService, ProxyLogRepository logRepository) {
        this.proxyService = proxyService;
        this.logRepository = logRepository;
    }

    @PostMapping("/users/get-profile")
    @PreAuthorize("hasRole('USER')")
    public ResponseEntity<UserResponseDTO> getUserProfile(@Valid @RequestBody GetUserRequest request) {
        log.info("Processing secure REST User GET request for ID: {}", request.userId());
        
        // Execute conversion mapping, marshalling, and make downstream legacy SOAP call
        UserResponseDTO response = proxyService.callLegacyUserSoap(request);
        
        // Write audit footprint back onto transaction log context
        logRepository.save(new ProxyTransactionLog(
            "UserAccountService",
            "/api/v1/users/get-profile",
            "GetUser",
            "SUCCESS",
            200
        ));
        
        return ResponseEntity.ok(response);
    }

    @PostMapping("/payments/authorize")
    @PreAuthorize("hasRole('PAYMENT_ADMIN')")
    public ResponseEntity<PaymentResponseDTO> authorizePayment(@Valid @RequestBody AuthorizePaymentRequest request) {
        log.info("Processing secure Payment Authorize for Merchant: {}, Amount: {}", 
            request.merchantId(), request.amount());
        
        PaymentResponseDTO response = proxyService.callLegacyPaymentSoap(request);
        
        logRepository.save(new ProxyTransactionLog(
            "LegacyCardPaymentSoapSpec",
            "/api/v1/payments/authorize",
            "AuthorizePayment",
            "SUCCESS",
            200
        ));
        
        return ResponseEntity.ok(response);
    }
}
