# Gemini subscription provider

The optional `examples/extensions/gemini` extension adds a provider named `gemini`. Sign in with `/login gemini`, then choose a model in `/model`. Gemini and other authenticated providers share the same model picker and AkramCode conversation. AkramCode executes tool calls; the extension does not start a separate CLI agent.

## Account restrictions

This extension uses an unofficial Antigravity OAuth integration. It is not endorsed by Google. [Google's consumer terms, section 6](https://www.antigravity.google/terms), prohibit third-party access and allow suspension or termination of Antigravity/Gemini CLI accounts. Connecting a Google AI Pro/Ultra subscription here carries that risk. Google also [does not support wrapping its CLI inside third-party coding agents](https://www.antigravity.google/docs/faq/).

Use the extension only after reviewing those restrictions and accepting the account risk. Access and quotas depend on the signed-in account. An API-key provider is a different billing path and does not consume an existing consumer subscription.

## Load the extension

From an AkramCode source checkout:

```sh
akramcode --extension ./packages/coding-agent/examples/extensions/gemini
```

To load it for every project, copy the complete `gemini` directory into `~/.akramcode/agent/extensions/`. Preserve the accompanying license and attribution files. The installed standalone AkramCode binary can load the extension without rebuilding the application.

## Sign in and select a model

1. Run `/login gemini` and complete Google sign-in in your browser.
2. Return to AkramCode and open `/model`.
3. Choose a model from the `gemini` provider. Models from other authenticated providers remain available in that picker.

The browser redirects to a temporary listener on the local loopback interface. If your browser runs on another machine, paste its complete redirect URL into the login prompt. Escape cancels login and closes the listener.

The extension uses AkramCode's encrypted credential store and token-refresh mechanism. It does not import browser cookies or save credentials in a second account file. `/logout gemini` removes the locally stored credential; revoke access in your Google account settings if you also want to revoke Google's grant.

The provider refreshes its model catalog from the account's service response and caches it through AkramCode. Model visibility and quota can differ between accounts. A successful sign-in does not by itself verify that inference requests are allowed; send a short prompt to confirm access.

If Google returns `User location is not supported`, the account can sign in and list models while inference remains unavailable from the current network. Repeating sign-in does not resolve that error. AkramCode's user-level `httpProxy` setting can apply an existing proxy to its HTTP clients; see [network settings](settings.md#network-and-retries).
