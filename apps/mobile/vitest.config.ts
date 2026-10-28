import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 resolve:{alias:{'react-native':fileURLToPath(new URL('./test/native-mock.ts',import.meta.url))}},
 test:{include:['test/*.test.tsx'],environment:'node'},
});
