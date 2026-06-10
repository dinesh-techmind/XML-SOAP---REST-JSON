package org.bank.bridge.exception;

public class LegacySoapFaultException extends RuntimeException {
    private final String soapFaultXml;

    public LegacySoapFaultException(String soapFaultXml) {
        super("SOAP Fault returned by legacy services");
        this.soapFaultXml = soapFaultXml;
    }

    public String getSoapFaultXml() {
        return soapFaultXml;
    }
}
