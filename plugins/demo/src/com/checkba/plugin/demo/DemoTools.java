package com.checkba.plugin.demo;

import dev.langchain4j.agent.tool.Tool;

public class DemoTools {

    @Tool("A simple demo tool to verify plugin integration. Returns a greeting message.")
    public String demo_greet(String name) {
        return "Hello " + name + ", this is a message from the Demo Plugin!";
    }
}
