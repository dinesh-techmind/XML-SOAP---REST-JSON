package org.bank.bridge.dto;

public record PaymentResponseDTO(
    String transactionId,
    String authorizationCode,
    String responseCode,
    String status
) {}
