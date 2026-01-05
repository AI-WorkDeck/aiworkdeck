package com.checkba.service;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.io.File;
import java.io.FileOutputStream;
import java.util.*;

@Service
public class TtsService {

    private static final Logger logger = LoggerFactory.getLogger(TtsService.class);
    private static final String TEMP_AUDIO_DIR = System.getProperty("java.io.tmpdir") + File.separator + "easyvoice_audio";
    // Mapped via Docker: host port 9549 -> container port 3000
    private static final String TTS_API_BASE = "http://localhost:9549/api/v1/tts";
    private final RestTemplate restTemplate = new RestTemplate();

    public TtsService() {
        new File(TEMP_AUDIO_DIR).mkdirs();
    }

    public List<VoiceOption> getVoices() {
        try {
            String url = TTS_API_BASE + "/voiceList";
            ResponseEntity<VoiceListResponse> response = restTemplate.getForEntity(url, VoiceListResponse.class);
            
            if (response.getBody() != null && response.getBody().isSuccess()) {
                List<VoiceOption> result = new ArrayList<>();
                List<VoiceJson> data = response.getBody().getData();
                if (data != null) {
                    for (VoiceJson v : data) {
                        VoiceOption vo = new VoiceOption();
                        vo.setName(v.getName());
                        vo.setGender(v.getGender());
                        
                        // Extract locale from Name (e.g. en-US-AriaNeural -> en-US)
                        String name = v.getName();
                        if (name != null) {
                            String[] parts = name.split("-");
                            if (parts.length >= 2) {
                                vo.setLocale(parts[0] + "-" + parts[1]);
                            } else {
                                vo.setLocale("Unknown");
                            }
                        }
                        
                        result.add(vo);
                    }
                }
                return result;
            }
            logger.warn("Voice list response unsuccessful or empty: {}", response.getBody());
            return new ArrayList<>();
        } catch (Exception e) {
            logger.error("Failed to list voices from EasyVoice service at {}", TTS_API_BASE, e);
            // Return empty list instead of throwing to prevent crashing the UI completely
            return new ArrayList<>();
        }
    }

    public File generateAudio(String text, String voice, String rate, String pitch, String volume) {
        try {
            Map<String, Object> payload = new HashMap<>();
            payload.put("text", text);
            payload.put("voice", voice);
            payload.put("rate", rate);
            payload.put("pitch", pitch);
            payload.put("volume", volume);
            
            String generateUrl = TTS_API_BASE + "/generate";
            logger.info("Sending TTS request to {}: {}", generateUrl, payload);
            
            ResponseEntity<GenerateResponse> response = restTemplate.postForEntity(generateUrl, payload, GenerateResponse.class);
            
            if (response.getBody() == null || !response.getBody().isSuccess()) {
                 throw new RuntimeException("TTS Generation failed: " + (response.getBody() != null ? response.getBody().toString() : "Null response"));
            }
            
            String filename = response.getBody().getData().getFile();
            String downloadUrl = TTS_API_BASE + "/download/" + filename;
            
            logger.info("Downloading audio from: {}", downloadUrl);
            ResponseEntity<byte[]> downloadResp = restTemplate.exchange(downloadUrl, HttpMethod.GET, null, byte[].class);
            
            if (downloadResp.getStatusCode().is2xxSuccessful() && downloadResp.getBody() != null) {
                 String outName = UUID.randomUUID().toString() + ".mp3";
                 File outputFile = new File(TEMP_AUDIO_DIR, outName);
                 try (FileOutputStream fos = new FileOutputStream(outputFile)) {
                     fos.write(downloadResp.getBody());
                 }
                 return outputFile;
            } else {
                throw new RuntimeException("Failed to download audio file from EasyVoice");
            }

        } catch (Exception e) {
            logger.error("Failed to generate audio via EasyVoice", e);
            throw new RuntimeException("Failed to generate audio: " + e.getMessage(), e);
        }
    }

    // Response DTOs
    public static class VoiceListResponse {
        private int code;
        private boolean success;
        private List<VoiceJson> data;
        
        public boolean isSuccess() { return success; }
        public void setSuccess(boolean success) { this.success = success; }
        public List<VoiceJson> getData() { return data; }
        public void setData(List<VoiceJson> data) { this.data = data; }
    }

    public static class VoiceJson {
        @JsonProperty("Name")
        private String Name;
        @JsonProperty("Gender")
        private String Gender;
        
        public String getName() { return Name; }
        public void setName(String name) { Name = name; }
        public String getGender() { return Gender; }
        public void setGender(String gender) { Gender = gender; }
    }

    public static class GenerateResponse {
        private int code;
        private boolean success;
        private GenerateData data;
        
        public boolean isSuccess() { return success; }
        public void setSuccess(boolean success) { this.success = success; }
        public GenerateData getData() { return data; }
        public void setData(GenerateData data) { this.data = data; }
    }

    public static class GenerateData {
        private String file; // Filename for download
        private String audio; // Absolute path inside container
        
        public String getFile() { return file; }
        public void setFile(String file) { this.file = file; }
        public String getAudio() { return audio; }
        public void setAudio(String audio) { this.audio = audio; }
    }

    public static class VoiceOption {
        private String name;
        private String gender;
        private String locale;
        private String cnName;

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getGender() { return gender; }
        public void setGender(String gender) { this.gender = gender; }
        public String getLocale() { return locale; }
        public void setLocale(String locale) { this.locale = locale; }
        public String getCnName() { return cnName; }
        public void setCnName(String cnName) { this.cnName = cnName; }
    }
}
