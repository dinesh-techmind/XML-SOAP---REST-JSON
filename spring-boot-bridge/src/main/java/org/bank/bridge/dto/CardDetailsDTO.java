package org.bank.bridge.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CardDetailsDTO(
    @NotNull
    @Size(min = 16, max = 16, message = "cardNumber must be 16 digits")
    String cardNumber,

    @NotNull
    String expiryDate,

    @NotNull
    @Size(min = 3, max = 3, message = "cvv must be 3 digits")
    String cvv
) {}
