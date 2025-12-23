package com.checkba.service.ocr;

public class OcrResult {
    private String text;
    private String raw;

    public OcrResult() {
    }

    public OcrResult(String text, String raw) {
        this.text = text;
        this.raw = raw;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }

    public String getRaw() {
        return raw;
    }

    public void setRaw(String raw) {
        this.raw = raw;
    }
}
