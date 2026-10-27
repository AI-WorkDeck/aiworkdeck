// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Small test-only host for the separately installed LibreOffice Python library.
// Its framework binary and pyuno use the same Python ABI; no soffice is launched.
#include <dlfcn.h>
#include <stdio.h>

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: python-host Python-framework-library script [args]\n"); return 2; }
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
    if (!library) { fprintf(stderr, "%s\n", dlerror()); return 3; }
    int (*run)(int, char **) = dlsym(library, "Py_BytesMain");
    if (!run) { fprintf(stderr, "Py_BytesMain unavailable\n"); return 4; }
    return run(argc - 1, argv + 1);
}
