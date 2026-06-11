```markdown
# real-estate-email-agent Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `real-estate-email-agent` repository. The project is built with TypeScript and Next.js, focusing on maintainable code structure, consistent naming, and modular design. You'll learn how to follow the repository's coding conventions, write and organize tests, and use common commands for efficient development.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `emailSender.ts`, `userProfile.tsx`

### Import Style
- Use **alias imports** for modules.
  - Example:
    ```typescript
    import { sendEmail } from '@/utils/emailSender';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // In emailSender.ts
    export function sendEmail(to: string, subject: string, body: string) { ... }
    ```

### Commit Messages
- Commit messages are **freeform** (no strict prefix), typically concise (~57 characters).
  - Example:  
    ```
    Add email template for new property listing notifications
    ```

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new functionality.
**Command:** `/add-feature`

1. Create a new file using camelCase in the appropriate directory.
2. Use alias imports to include dependencies.
3. Export your functions or components using named exports.
4. Write or update tests in a corresponding `.test.ts` file.
5. Commit your changes with a clear, concise message.

### Running Tests
**Trigger:** To verify code correctness after changes.
**Command:** `/run-tests`

1. Locate or create test files using the `*.test.ts` pattern.
2. Run the test suite using your preferred test runner (framework not specified).
3. Review test results and fix any failures.
4. Commit updates as needed.

## Testing Patterns

- **Test File Naming:** Use the `.test.ts` suffix for all test files.
  - Example: `emailSender.test.ts`
- **Test Placement:** Place test files alongside or within the relevant module directory.
- **Framework:** Not explicitly specified—use the project's preferred test runner.
- **Example Test:**
  ```typescript
  import { sendEmail } from '@/utils/emailSender';

  test('sendEmail sends an email with correct subject', () => {
    // ...test implementation
  });
  ```

## Commands
| Command        | Purpose                                      |
|----------------|----------------------------------------------|
| /add-feature   | Start the workflow for adding a new feature  |
| /run-tests     | Run the test suite for the codebase          |
```
