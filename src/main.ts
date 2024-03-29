import startup from "./core";
import configs from "./configs";
import { Client } from "icqq";

const account = parseInt(process.argv[process.argv.length - 1] as string);

export function main() {
  if (account > 10000 && account < 0xffffffff) {
    process.title = "OICQ/OneBot - " + account;
    startup(account, configs);
  } else {
    console.log(`Usage: oicq-http2 account`);
    console.log(`Example: oicq-http2 147258369`);
  }

  process.on("unhandledRejection", (a) => {
    console.log(a);
  });
}

export { Client };
