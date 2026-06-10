package org.bank.bridge.entity;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "proxy_transaction_logs")
public class ProxyTransactionLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String serviceName;
    private String restEndpoint;
    private String actionName;
    private String status;
    private int responseCode;
    private Instant timestamp;

    public ProxyTransactionLog() {
        this.timestamp = Instant.now();
    }

    public ProxyTransactionLog(String serviceName, String restEndpoint, String actionName, String status, int responseCode) {
        this();
        this.serviceName = serviceName;
        this.restEndpoint = restEndpoint;
        this.actionName = actionName;
        this.status = status;
        this.responseCode = responseCode;
    }

    // Standard getters and setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getServiceName() { return serviceName; }
    public void setServiceName(String serviceName) { this.serviceName = serviceName; }

    public String getRestEndpoint() { return restEndpoint; }
    public void setRestEndpoint(String restEndpoint) { this.restEndpoint = restEndpoint; }

    public String getActionName() { return actionName; }
    public void setActionName(String actionName) { this.actionName = actionName; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public int getResponseCode() { return responseCode; }
    public void setResponseCode(int responseCode) { this.responseCode = responseCode; }

    public Instant getTimestamp() { return timestamp; }
    public void setTimestamp(Instant timestamp) { this.timestamp = timestamp; }
}
