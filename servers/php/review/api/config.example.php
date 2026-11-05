<?php
// Copy to config.php and fill in. (Environment variables REVIEW_PASSCODE, ALLOWED_ORIGINS
// and REVIEW_DB override these, if your host lets you set them.)
return [
  // The passcode reviewers type in. Pick something not easy to guess.
  'passcode' => 'change-me',

  // Only when the website is on a different domain from this API, e.g.
  // 'https://client.com,https://www.client.com'. Leave empty for same-site installs.
  'allowed_origins' => '',

  // Where the SQLite database goes. The folder must be writable by PHP.
  // Best practice: a folder outside the public web root, e.g. '/home/you/review-data/review.sqlite'.
  'db' => __DIR__ . '/data/.ht.review.sqlite',
];
