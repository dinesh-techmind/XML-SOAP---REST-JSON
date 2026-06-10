package org.bank.bridge.dto;

import jakarta.xml.bind.annotation.*;

@XmlAccessorType(XmlAccessType.FIELD)
@XmlType(name = "", propOrder = {
    "userId",
    "authToken"
})
@XmlRootElement(name = "GetUserRequest", namespace = "http://legacy.bank.org/userservice/")
public class GetUserRequestJaxb {

    @XmlElement(name = "UserId", namespace = "http://legacy.bank.org/userservice/")
    protected int userId;

    @XmlElement(name = "AuthToken", namespace = "http://legacy.bank.org/userservice/", required = true)
    protected String authToken;

    public int getUserId() { return userId; }
    public void setUserId(int value) { this.userId = value; }

    public String getAuthToken() { return authToken; }
    public void setAuthToken(String value) { this.authToken = value; }
}
