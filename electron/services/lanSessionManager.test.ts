import { createLanSession, destroyLanSessionsForUser, getLanSession } from "./lanSessionManager";

describe("destroyLanSessionsForUser", () => {
  test("ends every phone session for that user and leaves others signed in", () => {
    const priya = createLanSession(
      { username: "Priya", role: "captain", displayName: "Captain Priya" },
      "device-priya",
    );
    const priyaPhone = createLanSession(
      { username: "priya", role: "captain", displayName: "Captain Priya" },
      "device-priya-2",
    );
    const rahul = createLanSession(
      { username: "rahul", role: "captain", displayName: "Captain Rahul" },
      "device-rahul",
    );

    expect(destroyLanSessionsForUser("PRIYA")).toBe(2);
    expect(getLanSession(priya.token)).toBeNull();
    expect(getLanSession(priyaPhone.token)).toBeNull();
    expect(getLanSession(rahul.token)?.username).toBe("rahul");
  });
});
