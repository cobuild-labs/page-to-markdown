/**
 * config.js - the only file you need to edit to brand the extension.
 *
 * Leave a value empty ('') to hide whatever uses it. For example, with no
 * supportUrl there is no Support button and no "Enjoying it?" prompt.
 */
var PTM_CONFIG = {
  name: 'Page to Markdown',

  // "Buy me a coffee": one payment link per choice (Stripe Payment Links,
  // Ko-fi, Buy Me a Coffee...). Links must start with https://. Leave price
  // empty for a "pick your own amount" link. With no tiers and no
  // supportUrl, every coffee button is hidden.
  supportTiers: [
    { price: 'S$3', name: 'A small coffee', note: 'A quick espresso to keep me going.', icon: 'cup', url: 'https://buy.stripe.com/dRmbJ2bJNfPWfwheUX00001' },
    { price: 'S$10', name: 'A café coffee', note: 'A proper sit-down coffee while I build the next thing.', icon: 'mug', url: 'https://buy.stripe.com/28EbJ2bJNeLS1FrfZ100002' },
    { price: 'S$100', name: 'A month of coffee', note: 'A whole month of mornings. You are a legend.', icon: 'calendar', url: 'https://buy.stripe.com/6oUaEY9BFdHO83PfZ100003' },
    { price: '', name: 'Your own amount', note: 'Whatever feels right.', icon: 'heart', url: 'https://buy.stripe.com/3cI3cwg03fPWbg128b00004' }
  ],
  // A single support page instead of tiers, e.g. 'https://buymeacoffee.com/yourname'.
  supportUrl: '',
  supportLabel: 'Buy me a coffee',

  // The GitHub repository, e.g. 'https://github.com/yourname/page-to-markdown'.
  // Used for "Star on GitHub" and "Report a problem".
  repoUrl: 'https://github.com/cobuild-labs/page-to-markdown',

  // Show the "Enjoying it?" card after this many successful exports.
  promptAfterExports: 5,
  // If the user picks "Maybe later", ask again after this many more.
  promptSnoozeExports: 25
};
