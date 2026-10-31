// Consumer fixtures exercise the same repository adapter as production. Native
// storage is intentionally used instead in migration/persistence-boundary tests.
import { browserStorage } from "./adapters/browserRecordStore";
import { hydrateFromServer, resetFactoryDataSyncForTests, setFactoryDataIdentity } from "./factoryDataSync";
export const testDirectoryStorage = {
  ...browserStorage,
  clear() {
    window.localStorage.clear();
    resetFactoryDataSyncForTests();
    setFactoryDataIdentity("live:consumer-fixture", true);
    hydrateFromServer({});
  },
};
