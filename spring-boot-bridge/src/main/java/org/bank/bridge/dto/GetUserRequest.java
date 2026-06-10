package org.bank.bridge.dto;

import jakarta.validation.constraints.NotNull;

public record GetUserRequest(
    @NotNull(message = "userId must not be null")
    Integer userId,

    @NotNull(message = "authToken must not be null")
    String authToken
) {}
