export class OAuthBearerMechanism {
  name = "OAUTHBEARER";
  clientFirst = true;

  response(cred: { username?: string; authzid?: string; password?: string; token?: string }) {
    const token = cred.token ?? cred.password;
    if (!token) {
      throw new Error("OAUTHBEARER requires a token.");
    }
    const authzid = cred.authzid ?? cred.username;
    const gs2Header = authzid ? `n,a=${authzid},` : "n,,";
    return `${gs2Header}\u0001auth=Bearer ${token}\u0001\u0001`;
  }

  challenge() {
    return this;
  }
}
