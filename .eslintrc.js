module.exports = {
  "parserOptions": {
    "project": './tsconfig.json',
    "sourceType": "module"
  },
  "extends": [
    "@vkontakte/eslint-config/typescript"
  ],
  "settings": {
    "react": {
      "version": "16.0",
    }
  },
  "rules": {
    // Disabled because: no configurable options for .length > 0, arr[0] and similar constructions.
    "no-magic-numbers": "off",
    "@typescript-eslint/no-magic-numbers": "off",

    // Disabled because: errors on "displayMode || '5min'" expression with nullable variable.
    "@typescript-eslint/no-unnecessary-condition": "off",

    // Disabled: covered with stricter tsc settings
    "@typescript-eslint/typedef": "off",
  }
};
