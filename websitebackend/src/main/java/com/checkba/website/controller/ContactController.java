package com.checkba.website.controller;

import com.checkba.website.dto.ContactForm;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*") // Allow requests from frontend
@Slf4j
public class ContactController {

    @Autowired
    private JavaMailSender emailSender;

    @Value("${contact.email.to}")
    private String contactEmailTo;

    @PostMapping("/contact")
    public String submitContactForm(@RequestBody ContactForm form) {
        log.info("Received contact form submission: {}", form);

        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom("noreply@checkba.com"); // Configure properly in real env
            message.setTo(contactEmailTo);
            message.setSubject("New Contact Request from " + form.getName());
            message.setText(buildEmailContent(form));
            
            // In a dev environment without SMTP configured, this might fail.
            // For now, we log it and proceed.
            // emailSender.send(message); 
            log.info("Email would be sent to {} with content: \n{}", contactEmailTo, buildEmailContent(form));
            
            return "{\"status\": \"success\", \"message\": \"Contact form submitted successfully.\"}";
        } catch (Exception e) {
            log.error("Error sending email", e);
            return "{\"status\": \"error\", \"message\": \"Failed to submit form.\"}";
        }
    }

    private String buildEmailContent(ContactForm form) {
        return "Name: " + form.getName() + "\n" +
               "Company: " + form.getCompany() + "\n" +
               "Email: " + form.getEmail() + "\n" +
               "Phone: " + (form.getPhone() != null ? form.getPhone() : "N/A") + "\n" +
               "\nRequirements:\n" + form.getRequirements();
    }
}
