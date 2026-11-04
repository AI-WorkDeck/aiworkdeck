// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import java.lang.annotation.*;
/** Only annotate endpoints that authorize account and resource before returning file bytes. */
@Target(ElementType.METHOD) @Retention(RetentionPolicy.RUNTIME)
public @interface CloudMeteredDownload {}
