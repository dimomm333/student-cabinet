import {createPrismaClient} from '../src/lib/prisma-client.ts';
import {reconcileOfficialFinals} from '../src/lib/brs-final-review.ts';
const db=createPrismaClient();
try {console.info(JSON.stringify(await reconcileOfficialFinals(db)));}finally{await db.$disconnect();}
