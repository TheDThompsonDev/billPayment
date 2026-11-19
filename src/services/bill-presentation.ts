// Shared by the initial server render and polling API. Internal storage locations
// and browser reservation tokens must never cross the client boundary.
export function presentBill<
  T extends {
    documentPath: string | null;
    documentHash: string | null;
    navigation: { runToken: string | null } | null;
  },
>(bill: T) {
  const { documentPath, documentHash, navigation, ...publicBill } = bill;
  // The hash is an internal fixture lookup key, not presentation data.
  void documentHash;
  const publicNavigation = navigation ? omitRunToken(navigation) : null;
  return {
    ...publicBill,
    hasDocument: Boolean(documentPath),
    navigation: publicNavigation,
  };
}

function omitRunToken<T extends { runToken: string | null }>(navigation: T) {
  const { runToken, ...publicNavigation } = navigation;
  void runToken;
  return publicNavigation;
}
