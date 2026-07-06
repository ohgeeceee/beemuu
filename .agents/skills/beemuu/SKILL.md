```markdown
# beemuu Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `beemuu` JavaScript codebase. It covers file naming, import/export styles, commit message patterns, and how to write and run tests. While no specific frameworks or automated workflows were detected, this guide will help you contribute code that matches the project's established standards.

## Coding Conventions

### File Naming
- **Style:** Snake case (`snake_case`)
- **Example:**  
  ```text
  user_profile.js
  data_manager.test.js
  ```

### Imports
- **Style:** Relative imports
- **Example:**
  ```javascript
  import { fetchData } from './data_manager.js';
  ```

### Exports
- **Style:** Named exports
- **Example:**
  ```javascript
  // In data_manager.js
  export function fetchData() { ... }
  ```

### Commit Messages
- **Types:** Mixed (features, releases, etc.)
- **Prefixes:** `feat`, `release`
- **Average Length:** ~42 characters
- **Examples:**
  ```
  feat: add user authentication module
  release: v1.2.0
  ```

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new functionality  
**Command:** `/add-feature`

1. Create a new file using snake_case (e.g., `new_feature.js`).
2. Write your code using named exports.
3. Import dependencies using relative paths.
4. Write corresponding tests in a file named `new_feature.test.js`.
5. Commit with a message starting with `feat:`, e.g.,  
   ```
   feat: implement new feature for user login
   ```

### Releasing a New Version
**Trigger:** When publishing a new release  
**Command:** `/release`

1. Ensure all features and fixes are merged.
2. Update version information as needed.
3. Commit with a message starting with `release:`, e.g.,  
   ```
   release: v1.3.0
   ```
4. Tag and push the release as per project standards.

## Testing Patterns

- **Test File Naming:** Use the pattern `*.test.js` (e.g., `user_profile.test.js`).
- **Framework:** Not explicitly detected; follow standard JS testing practices.
- **Example:**
  ```javascript
  // user_profile.test.js
  import { getUserProfile } from './user_profile.js';

  test('should return user profile data', () => {
    const result = getUserProfile('alice');
    expect(result.name).toBe('Alice');
  });
  ```

## Commands
| Command        | Purpose                                 |
|----------------|-----------------------------------------|
| /add-feature   | Start a new feature implementation      |
| /release       | Prepare and commit a new release        |
```
