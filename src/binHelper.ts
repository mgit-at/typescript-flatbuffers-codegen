import {Options} from 'yargs';

export function logAndExit(str: string) {
    console.log(str);
    process.exit(1);
}

export function yargsOptions<T extends { [key: string]: Options }>(options: T): T {
    return options;
}
