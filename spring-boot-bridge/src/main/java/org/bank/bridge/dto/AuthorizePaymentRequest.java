package org.bank.bridge.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record AuthorizePaymentRequest(
    @NotNull(message = "merchantId must not be null")
    String merchantId,

    @NotNull(message = "amount must not be null")
    @DecimalMin(value = "0.01", message = "amount must be positive")
    BigDecimal amount,

    @NotNull(message = "currencyCode must not be null")
    String currencyCode,

    @Valid
    @NotNull(message = "cardDetails must not be null")
    CardDetailsDTO cardDetails
) {}
