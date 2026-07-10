```markdown
# beemuu Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill covers the core development patterns and conventions used in the `beemuu` JavaScript codebase. It documents file organization, code style, commit practices, and testing patterns to ensure consistency and maintainability. Use this guide to onboard quickly or to keep your contributions aligned with project standards.

## Coding Conventions

### File Naming
- Use **camelCase** for all file names.
  - Example: `userProfile.js`, `dataFetcher.js`

### Imports
- Use **relative imports** for modules within the project.
  - Example:
    ```javascript
    import { fetchData } from './dataFetcher';
    ```

### Exports
- Use **named exports** for all modules.
  - Example:
    ```javascript
    // In dataFetcher.js
    export function fetchData() { ... }
    ```

### Commit Messages
- Follow the **Conventional Commits** specification.
- Use the `fix` prefix for bug fixes.
- Keep commit messages concise (average 68 characters).
  - Example:
    ```
    fix: correct calculation in userProfile age display
    ```

## Workflows

### Fixing a Bug
**Trigger:** When a bug is identified and needs to be resolved  
**Command:** `/fix-bug`

1. Create a new branch for your fix.
2. Make the necessary code changes following coding conventions.
3. Write or update tests in `*.test.*` files to cover the fix.
4. Commit your changes using the `fix:` prefix in the commit message.
5. Open a pull request for review.

### Adding a New Feature
**Trigger:** When implementing new functionality  
**Command:** `/add-feature`

1. Create a new branch for your feature.
2. Add new files using camelCase naming.
3. Use relative imports and named exports for all modules.
4. Write tests in a new or existing `*.test.*` file.
5. Commit your changes with a clear, conventional message.
6. Open a pull request for review.

### Running Tests
**Trigger:** To verify code correctness before merging or after changes  
**Command:** `/run-tests`

1. Locate all `*.test.*` files in the repository.
2. Use the project's preferred test runner (framework unknown; check project docs or scripts).
3. Run the test suite and review results.
4. Address any failing tests before merging.

## Testing Patterns

- Test files follow the `*.test.*` naming convention (e.g., `userProfile.test.js`).
- The testing framework is not specified; consult project documentation for setup.
- Place tests alongside the modules they cover or in a dedicated test directory.
- Example test file structure:
  ```
  src/
    userProfile.js
    userProfile.test.js
  ```

## Commands
| Command      | Purpose                                      |
|--------------|----------------------------------------------|
| /fix-bug     | Start the bug fixing workflow                |
| /add-feature | Start the new feature development workflow   |
| /run-tests   | Run all tests in the repository              |
```
