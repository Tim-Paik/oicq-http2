import startup from "./core.js";
import configs from "./configs.js";

const account = parseInt(process.argv[process.argv.length - 1]);

export default function main() {
  if (account > 10000 && account < 0xffffffff) {
    process.title = "OICQ/OneBot - " + account;
    startup(account, configs);
  } else {
    console.log(`Usage: ${process.argv[0]} account`);
    console.log(`Example: ${process.argv[0]} 147258369`);
  }

  process.on("unhandledRejection", (a) => {
    console.log(a);
  });
}
