#!/usr/bin/env node
try {
  const { main } = require("./cli");
  main();
} catch {
  console.log(`Please run "yarn install" first!`);
}
