```markdown
# beemuu Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `beemuu` Rust codebase. It covers file naming, import/export styles, commit message conventions, and testing patterns. By following these guidelines, contributors can maintain consistency and quality across the project.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myModule.rs`, `userProfile.rs`

### Import Style
- Use **relative imports** within the codebase.
  - Example:
    ```rust
    mod utils;
    use crate::utils::helperFunction;
    ```

### Export Style
- Use **named exports** for modules and functions.
  - Example:
    ```rust
    pub fn processData() { /* ... */ }
    pub struct User { /* ... */ }
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use the `fix` prefix for bug fixes.
- Commit message length averages 73 characters.
  - Example:
    ```
    fix: correct off-by-one error in pagination logic
    ```

## Workflows

### Code Contribution
**Trigger:** When adding or updating code in the repository  
**Command:** `/contribute`

1. Create or update files using camelCase naming.
2. Use relative imports for referencing other modules.
3. Export functions and structs using named exports.
4. Write a commit message using the conventional format (e.g., `fix: ...`).
5. Submit a pull request for review.

### Testing
**Trigger:** When writing or running tests  
**Command:** `/test`

1. Create test files with the `*.test.*` pattern (e.g., `userProfile.test.rs`).
2. Write tests using the Rust testing framework (framework not explicitly detected).
3. Run tests using Cargo:
    ```sh
    cargo test
    ```
4. Ensure all tests pass before merging changes.

## Testing Patterns

- Test files follow the `*.test.*` naming convention.
  - Example: `dataParser.test.rs`
- The testing framework is not explicitly specified; use Rust's built-in test framework.
- Example test:
    ```rust
    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn test_process_data() {
            assert_eq!(processData(), expected_value);
        }
    }
    ```

## Commands
| Command      | Purpose                              |
|--------------|--------------------------------------|
| /contribute  | Start the code contribution workflow |
| /test        | Run and manage tests                 |
```