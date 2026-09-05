"use strict";
window.mountBeemuuPlugins({
  importProfiles: async content => {
    try {
      return await invoke("import_profiles", { content });
    } catch (error) {
      throw new Error(`Profile import failed: ${error}. Earlier valid profiles may already be loaded; restart to clear session imports.`);
    } finally {
      await Promise.all([loadProfiles(), loadLogProfiles(), fillShareProfiles()]);
    }
  },
});
