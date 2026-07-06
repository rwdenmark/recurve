package com.recurve.controller;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Rate-limit key for a request, shared by the score and game-start endpoints.
 * The first X-Forwarded-For hop is the client behind a proxy. Client-settable,
 * so it only stops casual spam, not a caller who rotates the header.
 */
final class ClientKey {

    private ClientKey() {
    }

    static String from(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
