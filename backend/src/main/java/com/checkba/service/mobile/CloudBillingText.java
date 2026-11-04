// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.service.LangText;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import java.util.Map;
public final class CloudBillingText {
 private CloudBillingText() {}
 private static final Map<String,Map<String,String>> MESSAGES=load();
 private static Map<String,Map<String,String>> load() {
  try(var input=CloudBillingText.class.getResourceAsStream("/i18n/cloud-billing.json")) {
   if(input==null) throw new IllegalStateException("Cloud billing messages missing");
   return new ObjectMapper().readValue(input,new TypeReference<>(){});
  } catch(java.io.IOException failure) {throw new ExceptionInInitializerError(failure);}
 }
 public static String get(String token) {
  var values=MESSAGES.get(token);if(values==null) throw new IllegalArgumentException("Unknown cloud billing message token: "+token);
  return LangText.of(values);
 }
}
