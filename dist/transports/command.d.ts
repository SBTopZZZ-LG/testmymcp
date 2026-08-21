export interface SpawnSpec {
    command: string;
    args: string[];
    shell: boolean;
}
export declare function parseServerCommand(input: string): SpawnSpec;
