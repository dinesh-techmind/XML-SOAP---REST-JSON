package org.bank.bridge.dto;

public record UserResponseDTO(
    String status,
    Profile profile
) {
    public record Profile(
        Integer userId,
        String fullName,
        String email,
        String accessTier
    ) {}
}
