package com.checkba.website.dto;

import lombok.Data;

@Data
public class ContactForm {
    private String name;
    private String company;
    private String email;
    private String phone; // Optional
    private String requirements;
}
