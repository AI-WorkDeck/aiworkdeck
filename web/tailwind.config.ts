import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: ["class"],
    content: [
        "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
        "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                brand: {
                    DEFAULT: "#1A5336",
                    hover: "#2D7A52",
                    accent: "#5BD197",
                    "accent-hover": "#84E0B3",
                },
                neutral: {
                    darkBg: "#212629",
                    grayDark: "#2C3338",
                    grayMedium: "#6C757D",
                    grayLight: "#E9ECEF",
                    grayPale: "#F8F9FA",
                },
                semantic: {
                    success: "#5BD197",
                    warning: "#F1C40F",
                    danger: "#E74C3C",
                    info: "#3498DB",
                },
                // CSS Variable mapped colors for theme switching
                bg: "var(--bg)",
                surface: "var(--surface)",
                "surface-alt": "var(--surface-alt)",
                border: "var(--border)",
            },
            fontFamily: {
                sans: ["var(--font-inter)", "sans-serif"],
                mono: ["var(--font-mono)", "monospace"],
            },
            borderRadius: {
                sm: "10px",
                md: "14px",
                lg: "18px",
                xl: "22px",
                "2xl": "28px",
            },
            boxShadow: {
                sm: "var(--shadow-sm)",
                md: "var(--shadow-md)",
                lg: "var(--shadow-lg)",
            }
        },
    },
    plugins: [],
};
export default config;
