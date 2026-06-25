# Gemini Guidelines

Behavioral guidelines to ensure high-quality, maintainable, and minimalistic code. Bias toward caution over speed.

## 1. Development Workflow & Planning
- **Plan First:** Draft multi-step plans with verifiable success criteria in `.chat/<feature_name>.md` before implementing. Loop until verified.
- **Think Before Coding:** State assumptions explicitly. If multiple interpretations exist, present them.
- **Clarify & Push Back:** If a request is ambiguous or overly complex, stop and ask. Provide open-ended suggestions or suggest simpler approaches.
- **Goal-Driven Execution:** Transform tasks into verifiable goals (e.g., "Write a test that reproduces the bug, then make it pass").

## 2. Simplicity & Minimalism
- **Minimum Viable Code:** Write the minimum code needed to solve the problem. Less code is less debt. If it can be written in 50 lines instead of 200, rewrite it.
- **No Speculation:** No unrequested features, single-use abstractions, or overly flexible configurations.
- **Clean Logic:** Keep core logic straightforward and push implementation details to the edges.
- **Vanilla JS First:** Avoid introducing new frameworks (e.g., React, Vue) or large libraries (e.g., jQuery).
- **Global Scope Aware:** Remember all JavaScript is loaded via `<script>` tags; be mindful of the global scope.

## 3. Surgical & Iterative Changes
- **Iterate:** Implement changes step-by-step. Avoid large, sweeping modifications.
- **Minimal Footprint:** Touch only what you must. Every changed line should trace directly to the requested task.
- **Don't Fix Unbroken Things:** Do not refactor adjacent code or format unrelated lines. Mark issues found in existing code with a `TODO:` prefix.
- **Preserve Code (Deprecate):** When removing code, do not delete it outright. Comment it out with a `DEPRECATED` notice.

## 4. Coding Best Practices
- **Self-Documenting Code:** Code should explain itself. Avoid comments if a senior developer can easily understand the logic. Rely on clear structure and naming instead.
- **Functional & Stateless:** Prefer functional, immutable, and stateless approaches where they improve clarity.
- **Control Flow:** Use early returns to avoid nested conditions.
- **DRY (Don't Repeat Yourself):** Avoid code duplication. Create reusable components and functions.
- **Constants:** Use constants instead of functions where possible.

## 5. Formatting & Naming Conventions
- **Strict Formatting:**
  - **Indentation:** Use tabs.
  - **Semicolons:** Always use semicolons.
  - **Braces:** Use One True Brace Style (1TBS).
- **Naming Conventions:**
  - `camelCase`: For variables and functions. Names must be easy to understand. Meaningful abbreviations are encouraged to keep names short but readable (e.g., `handleBtnClick` instead of `handleButtonClickListener`).
  - `UPPER_SNAKE_CASE`: For constants and globals.
  - `_prefix`: Consider for internal/private functions.

---

> [!CRITICAL]
> ## 🚨 MANDATORY AGENT DIRECTIVE (FOR AI CODING AGENTS)
> Before modifying or adding any codebase logic, database structures, routes, or design assets:
> 
> 1. You **MUST** read this entire `/README.md` document first.
> 2. You **MUST** update this `/README.md` file reflecting any intended schema, color palette, or logic shifts **BEFORE** modifying the active code.
> 3. Ensure no custom UI for API keys is generated. Rely instead on standard `.env.example` configurations.
> 4. Do not delete or rename this file. Maintain all architectural transparency so subsequent developer agents can persist and scale the project with absolute consistency.

---