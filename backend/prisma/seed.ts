import {
  InviteStatus,
  LobbyCategory,
  LobbyMemberRole,
  LobbyMemberStatus,
  LobbyStatus,
  MediaKind,
  MomentVisibility,
  NotificationType,
  PrismaClient,
} from '@prisma/client';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const prisma = new PrismaClient();

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const NOT_IMPLEMENTED_PASSWORD_HASH = 'AUTH_NOT_IMPLEMENTED';

function fixedUuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function shiftedDate(base: Date, milliseconds: number): Date {
  return new Date(base.getTime() + milliseconds);
}

const namedUsers = [
  { handle: 'khalid', displayName: 'Khalid', score: 11 },
  { handle: 'alex', displayName: 'Alex', score: 17 },
  { handle: 'marina', displayName: 'Marina', score: 17 },
  { handle: 'john', displayName: 'John', score: 19 },
  { handle: 'kate', displayName: 'Kate', score: 5 },
  { handle: 'dan', displayName: 'Dan', score: 18 },
  { handle: 'tim', displayName: 'Tim', score: 18 },
  { handle: 'anna', displayName: 'Anna', score: 20 },
  { handle: 'max', displayName: 'Max', score: 12 },
  { handle: 'noah', displayName: 'Noah', score: 6 },
  { handle: 'mia', displayName: 'Mia', score: 7 },
  { handle: 'leo', displayName: 'Leo', score: 20 },
  { handle: 'sara', displayName: 'Sara', score: 19 },
  { handle: 'eric', displayName: 'Eric', score: 19 },
  { handle: 'ben', displayName: 'Ben', score: 4 },
  { handle: 'olivia', displayName: 'Olivia', score: 16 },
] as const;

const extraUsers = Array.from({ length: 32 }, (_, index) => ({
  handle: `demo_user_${String(index + 1).padStart(2, '0')}`,
  displayName: `Demo User ${index + 1}`,
  score: 2 + ((index * 3) % 19),
}));

const lobbyIds = {
  beer: fixedUuid(201),
  cs2: fixedUuid(202),
  pizza: fixedUuid(203),
  basketball: fixedUuid(204),
  cinema: fixedUuid(205),
  hike: fixedUuid(206),
  inactiveCinema: fixedUuid(207),
  inactiveHike: fixedUuid(208),
} as const;

const momentIds = {
  party: fixedUuid(301),
  hike: fixedUuid(302),
} as const;

async function seedUsers(): Promise<Map<string, string>> {
  const users = [...namedUsers, ...extraUsers];
  const ids = new Map<string, string>();

  for (const [index, user] of users.entries()) {
    const id = fixedUuid(index + 1);
    ids.set(user.handle, id);
    const data = {
      email: `${user.handle}@partymaker.local`,
      passwordHash: NOT_IMPLEMENTED_PASSWORD_HASH,
      handle: user.handle,
      displayName: user.displayName,
      city: 'Bishkek',
      countryCode: 'KG',
      extroversionScoreX2: user.score,
    };

    await prisma.user.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  }

  return ids;
}

function getUserId(users: Map<string, string>, handle: string): string {
  const id = users.get(handle);
  if (!id) {
    throw new Error(`Seed user not found: ${handle}`);
  }
  return id;
}

async function seedMedia(users: Map<string, string>): Promise<Record<string, string>> {
  const backendRoot = process.cwd();
  const sourceDirectory = resolve(backendRoot, '..', 'assets', 'photos');
  const uploadDirectory = resolve(backendRoot, 'uploads', 'demo');
  const ownerId = getUserId(users, 'khalid');
  const photoNames = ['party', 'basketball', 'cinema', 'hiking'] as const;
  const mediaIds: Record<string, string> = {};

  await mkdir(uploadDirectory, { recursive: true });

  for (const [index, photoName] of photoNames.entries()) {
    const id = fixedUuid(101 + index);
    const filename = `${photoName}.png`;
    const source = resolve(sourceDirectory, filename);
    const destination = resolve(uploadDirectory, filename);
    await copyFile(source, destination);
    const file = await stat(destination);
    const data = {
      ownerId,
      kind: MediaKind.IMAGE,
      storageKey: `demo/${filename}`,
      mimeType: 'image/png',
      bytes: file.size,
    };

    await prisma.mediaAsset.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
    mediaIds[photoName] = id;
  }

  const avatarMediaId = mediaIds.party;
  if (!avatarMediaId) {
    throw new Error('Party demo image was not seeded');
  }

  await prisma.user.update({
    where: { id: ownerId },
    data: { avatarMediaId },
  });

  return mediaIds;
}

async function seedLobbies(users: Map<string, string>, now: Date): Promise<void> {
  const lobbies = [
    {
      id: lobbyIds.beer,
      organizer: 'khalid',
      title: 'Beer tonight',
      description: "Let's chill, have some beers and good conversations.",
      category: LobbyCategory.DRINKS,
      status: LobbyStatus.PUBLISHED,
      isOnline: false,
      venueName: 'Bar Campus',
      address: 'Bishkek, Kyrgyzstan',
      latitude: 42.8746,
      longitude: 74.5698,
      startsAt: shiftedDate(now, 180 * MINUTE_MS),
      capacity: 6,
    },
    {
      id: lobbyIds.cs2,
      organizer: 'khalid',
      title: 'CS2 squad',
      description: 'A few friendly CS2 matches on Inferno. Bring your headset and a good mood — no pressure, just teamwork.',
      category: LobbyCategory.GAMING,
      status: LobbyStatus.PUBLISHED,
      isOnline: true,
      venueName: null,
      address: null,
      latitude: null,
      longitude: null,
      startsAt: shiftedDate(now, 300 * MINUTE_MS),
      capacity: 5,
    },
    {
      id: lobbyIds.pizza,
      organizer: 'marina',
      title: 'Pizza & chill',
      description: 'Let’s share a pizza, meet new people and enjoy a relaxed evening. Come as you are — everyone is welcome.',
      category: LobbyCategory.FOOD,
      status: LobbyStatus.PUBLISHED,
      isOnline: false,
      venueName: 'Chanti Pizza',
      address: 'Bishkek, Kyrgyzstan',
      latitude: 42.8697,
      longitude: 74.5857,
      startsAt: shiftedDate(now, 135 * MINUTE_MS),
      capacity: 6,
    },
    {
      id: lobbyIds.basketball,
      organizer: 'john',
      title: 'Basketball',
      description: 'A friendly game on the court. Any skill level is welcome. Bring your trainers and some water — we have the ball.',
      category: LobbyCategory.SPORT,
      status: LobbyStatus.PUBLISHED,
      isOnline: false,
      venueName: 'Arena North',
      address: 'Bishkek, Kyrgyzstan',
      latitude: 42.8864,
      longitude: 74.6122,
      startsAt: shiftedDate(now, 45 * MINUTE_MS),
      capacity: 10,
    },
    {
      id: lobbyIds.cinema,
      organizer: 'olivia',
      title: 'Cinema night',
      description: 'Let’s watch Superman (2025) together and chat about the film afterwards. We’ll meet at the cinema entrance.',
      category: LobbyCategory.MOVIES,
      status: LobbyStatus.PUBLISHED,
      isOnline: false,
      venueName: 'IMAX Bishkek Park',
      address: 'Bishkek Park, Bishkek, Kyrgyzstan',
      latitude: 42.8759,
      longitude: 74.5906,
      startsAt: shiftedDate(now, 330 * MINUTE_MS),
      capacity: 6,
    },
    {
      id: lobbyIds.hike,
      organizer: 'kate',
      title: 'Weekend hike',
      description: 'An easy walk in Ala-Archa with mountain views and a coffee stop. Bring comfortable shoes, water and a warm layer.',
      category: LobbyCategory.OUTDOORS,
      status: LobbyStatus.PUBLISHED,
      isOnline: false,
      venueName: 'Ala-Archa',
      address: 'Ala-Archa National Park, Kyrgyzstan',
      latitude: 42.6369,
      longitude: 74.4797,
      startsAt: shiftedDate(now, 27 * 60 * MINUTE_MS),
      capacity: 5,
    },
    {
      id: lobbyIds.inactiveCinema,
      organizer: 'khalid',
      title: 'Cinema night',
      description: 'Historical demo meetup retained for the inactive cinema chat.',
      category: LobbyCategory.MOVIES,
      status: LobbyStatus.COMPLETED,
      isOnline: false,
      venueName: 'IMAX Bishkek Park',
      address: 'Bishkek Park, Bishkek, Kyrgyzstan',
      latitude: 42.8759,
      longitude: 74.5906,
      startsAt: shiftedDate(now, -7 * DAY_MS),
      capacity: 6,
    },
    {
      id: lobbyIds.inactiveHike,
      organizer: 'khalid',
      title: 'Weekend hike',
      description: 'Historical demo meetup retained for the inactive hiking chat.',
      category: LobbyCategory.OUTDOORS,
      status: LobbyStatus.COMPLETED,
      isOnline: false,
      venueName: 'Ala-Archa',
      address: 'Ala-Archa National Park, Kyrgyzstan',
      latitude: 42.6369,
      longitude: 74.4797,
      startsAt: shiftedDate(now, -8 * DAY_MS),
      capacity: 5,
    },
  ];

  for (const lobby of lobbies) {
    const { id, organizer, ...data } = lobby;
    const persistenceData = {
      ...data,
      organizerId: getUserId(users, organizer),
      timeZone: 'Asia/Bishkek',
      minParticipants: 2,
    };
    await prisma.lobby.upsert({
      where: { id },
      create: { id, ...persistenceData },
      update: persistenceData,
    });
  }

  const joinedMemberships: Record<string, readonly string[]> = {
    beer: ['khalid', 'alex', 'marina', 'john'],
    cs2: ['khalid', 'noah', 'mia'],
    pizza: ['marina', 'alex', 'kate'],
    basketball: ['john', 'dan', 'tim', 'anna', 'leo', 'sara', 'eric'],
    cinema: ['olivia', 'khalid', 'noah', 'mia'],
    hike: ['kate', 'noah', 'ben'],
    inactiveCinema: ['khalid', 'marina', 'kate', 'john'],
    inactiveHike: ['khalid', 'kate', 'alex'],
  };

  const organizers: Record<string, string> = {
    beer: 'khalid',
    cs2: 'khalid',
    pizza: 'marina',
    basketball: 'john',
    cinema: 'olivia',
    hike: 'kate',
    inactiveCinema: 'khalid',
    inactiveHike: 'khalid',
  };

  for (const [lobbyKey, handles] of Object.entries(joinedMemberships)) {
    const lobbyId = lobbyIds[lobbyKey as keyof typeof lobbyIds];
    for (const handle of handles) {
      const userId = getUserId(users, handle);
      const role = organizers[lobbyKey] === handle
        ? LobbyMemberRole.ORGANIZER
        : LobbyMemberRole.MEMBER;
      await prisma.lobbyMember.upsert({
        where: { lobbyId_userId: { lobbyId, userId } },
        create: {
          lobbyId,
          userId,
          role,
          status: LobbyMemberStatus.JOINED,
          joinedAt: shiftedDate(now, -DAY_MS),
        },
        update: {
          role,
          status: LobbyMemberStatus.JOINED,
          leftAt: null,
        },
      });
    }
  }

  const formerMemberships = [
    { lobbyId: lobbyIds.basketball, handle: 'kate' },
    { lobbyId: lobbyIds.cinema, handle: 'max' },
  ];
  for (const membership of formerMemberships) {
    const userId = getUserId(users, membership.handle);
    await prisma.lobbyMember.upsert({
      where: { lobbyId_userId: { lobbyId: membership.lobbyId, userId } },
      create: {
        lobbyId: membership.lobbyId,
        userId,
        status: LobbyMemberStatus.LEFT,
        joinedAt: shiftedDate(now, -2 * DAY_MS),
        leftAt: shiftedDate(now, -DAY_MS),
      },
      update: {
        status: LobbyMemberStatus.LEFT,
        leftAt: shiftedDate(now, -DAY_MS),
      },
    });
  }
}

async function seedLobbyMedia(mediaIds: Record<string, string>): Promise<void> {
  const coverByLobby = [
    [lobbyIds.beer, 'party'],
    [lobbyIds.cs2, 'cinema'],
    [lobbyIds.pizza, 'party'],
    [lobbyIds.basketball, 'basketball'],
    [lobbyIds.cinema, 'cinema'],
    [lobbyIds.hike, 'hiking'],
    [lobbyIds.inactiveCinema, 'cinema'],
    [lobbyIds.inactiveHike, 'hiking'],
  ] as const;

  for (const [lobbyId, mediaName] of coverByLobby) {
    const mediaId = mediaIds[mediaName];
    if (!mediaId) {
      throw new Error(`Seed media not found: ${mediaName}`);
    }
    await prisma.lobbyMedia.upsert({
      where: { lobbyId_mediaId: { lobbyId, mediaId } },
      create: { lobbyId, mediaId, position: 0, isCover: true },
      update: { position: 0, isCover: true },
    });
  }
}

async function seedMessages(users: Map<string, string>, now: Date): Promise<void> {
  type MessageFixture = readonly [string, string];
  const conversations: Record<keyof typeof lobbyIds, readonly MessageFixture[]> = {
    beer: [
      ['alex', 'Table is booked! We’re meeting at Bar Campus at 20:00.'],
      ['marina', 'Perfect. Outside if the weather holds?'],
      ['khalid', 'I’m in. See you there!'],
      ['alex', 'Yes, on the terrace. I’ll get there a little early.'],
      ['marina', 'Great, I’ll look for you near the entrance.'],
    ],
    cs2: [
      ['john', 'Who’s ready for a match tonight? Inferno to warm up?'],
      ['alex', 'I’m in. Just updating the game.'],
      ['khalid', 'Count me in. I’ll bring the good calls.'],
      ['john', 'Nice! Let’s jump into voice chat at 22:00.'],
      ['alex', 'Sounds good. A chill game, no pressure.'],
    ],
    pizza: [
      ['marina', 'Shall we meet at Chanti Pizza at 19:00? I’ll grab a table.'],
      ['kate', 'Yes! One margherita and one mushroom pizza?'],
      ['khalid', 'Sounds like a plan!'],
      ['marina', 'Deal. We can order once everyone arrives.'],
      ['kate', 'I’ll be there a few minutes early. See you!'],
    ],
    basketball: [
      ['alex', 'Court at Arena North, 18:00. I’ve got the ball.'],
      ['john', 'Nice. Anyone up for a warm-up first?'],
      ['khalid', 'Definitely. Haven’t played in a while.'],
      ['alex', 'All good, we’re just playing for fun. Bring some water.'],
      ['john', 'See you at the court!'],
    ],
    cinema: [
      ['marina', 'Superman tomorrow at 20:30. Let’s meet by the IMAX entrance.'],
      ['kate', 'I’ll be there 15 minutes early for popcorn.'],
      ['khalid', 'Same! Save me a spot in the queue.'],
      ['marina', 'Of course. Coffee after the film?'],
      ['kate', 'Absolutely, we’ll have plenty to discuss.'],
    ],
    hike: [
      ['kate', 'Ala-Archa on Saturday! Let’s start at 08:30.'],
      ['alex', 'I’ll bring a thermos. Is the route beginner-friendly?'],
      ['khalid', 'Joining you. Mountain air sounds perfect.'],
      ['kate', 'Yes, an easy trail with plenty of breaks. Bring a warm layer.'],
      ['alex', 'Perfect. I’m packing water and a few snacks too.'],
    ],
    inactiveCinema: [
      ['marina', 'Thanks for a great evening! That final scene was something.'],
      ['kate', 'Still thinking about the soundtrack.'],
      ['khalid', 'Great film, even better company!'],
      ['marina', 'Let’s pick another film for next time.'],
      ['kate', 'I’m in. And coffee afterwards again!'],
    ],
    inactiveHike: [
      ['kate', 'Everyone home? What a beautiful day in the mountains.'],
      ['alex', 'Home and already looking through the photos.'],
      ['khalid', 'Thanks for the company and the coffee.'],
      ['kate', 'Let’s do another hike soon!'],
      ['alex', 'Absolutely. Same group, a new trail.'],
    ],
  };

  let messageNumber = 501;
  for (const [lobbyKey, messages] of Object.entries(conversations)) {
    const isHistorical = lobbyKey.startsWith('inactive');
    const lobbyId = lobbyIds[lobbyKey as keyof typeof lobbyIds];
    for (const [index, [author, body]] of messages.entries()) {
      const id = fixedUuid(messageNumber);
      messageNumber += 1;
      const baseOffset = isHistorical ? -7 * DAY_MS : -45 * MINUTE_MS;
      const createdAt = shiftedDate(now, baseOffset + index * 2 * MINUTE_MS);
      const data = {
        lobbyId,
        authorId: getUserId(users, author),
        body,
        createdAt,
      };
      await prisma.lobbyMessage.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
    }
  }
}

async function seedMoments(
  users: Map<string, string>,
  mediaIds: Record<string, string>,
  now: Date,
): Promise<Record<string, string>> {
  const moments = [
    {
      id: momentIds.party,
      author: 'alex',
      lobbyId: lobbyIds.pizza,
      caption: 'Had an amazing time! Great people, good pizza and even better vibes',
      createdAt: shiftedDate(now, -11 * DAY_MS),
      mediaName: 'party',
    },
    {
      id: momentIds.hike,
      author: 'marina',
      lobbyId: lobbyIds.hike,
      caption: 'Weekend well spent',
      createdAt: shiftedDate(now, -12 * DAY_MS),
      mediaName: 'hiking',
    },
  ] as const;

  for (const moment of moments) {
    const data = {
      authorId: getUserId(users, moment.author),
      lobbyId: moment.lobbyId,
      caption: moment.caption,
      visibility: MomentVisibility.PUBLIC,
      createdAt: moment.createdAt,
    };
    await prisma.moment.upsert({
      where: { id: moment.id },
      create: { id: moment.id, ...data },
      update: data,
    });

    const mediaId = mediaIds[moment.mediaName];
    if (!mediaId) {
      throw new Error(`Seed media not found: ${moment.mediaName}`);
    }
    await prisma.momentMedia.upsert({
      where: { momentId_mediaId: { momentId: moment.id, mediaId } },
      create: { momentId: moment.id, mediaId, position: 0 },
      update: { position: 0 },
    });
  }

  const allUserIds = [...users.values()];
  await prisma.momentLike.createMany({
    data: allUserIds.slice(0, 24).map((userId) => ({
      momentId: momentIds.party,
      userId,
    })),
    skipDuplicates: true,
  });
  await prisma.momentLike.createMany({
    data: allUserIds.slice(0, 32).map((userId) => ({
      momentId: momentIds.hike,
      userId,
    })),
    skipDuplicates: true,
  });

  const comments = [
    ['marina', momentIds.party, 'Such a good evening!'],
    ['john', momentIds.party, 'The pizza was worth it.'],
    ['kate', momentIds.party, 'Let’s do this again soon.'],
    ['dan', momentIds.party, 'Great photo!'],
    ['anna', momentIds.party, 'Looks fun.'],
    ['max', momentIds.party, 'Count me in next time.'],
    ['tim', momentIds.party, 'Nice group!'],
    ['tim', momentIds.hike, 'The view was incredible.'],
    ['alex', momentIds.hike, 'Perfect hiking weather.'],
    ['kate', momentIds.hike, 'Already planning the next trail.'],
    ['john', momentIds.hike, 'Beautiful place.'],
    ['anna', momentIds.hike, 'Love these photos.'],
  ] as const;
  const commentIds: Record<string, string> = {};

  for (const [index, [author, momentId, body]] of comments.entries()) {
    const id = fixedUuid(401 + index);
    commentIds[`${momentId}:${author}`] = id;
    const data = {
      momentId,
      authorId: getUserId(users, author),
      body,
      createdAt: shiftedDate(now, -(15 + index * 3) * MINUTE_MS),
    };
    await prisma.momentComment.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  }

  await prisma.follow.createMany({
    data: [
      { followerId: getUserId(users, 'khalid'), followingId: getUserId(users, 'alex') },
      { followerId: getUserId(users, 'khalid'), followingId: getUserId(users, 'marina') },
    ],
    skipDuplicates: true,
  });

  return commentIds;
}

async function seedActivity(
  users: Map<string, string>,
  commentIds: Record<string, string>,
  now: Date,
): Promise<void> {
  const khalidId = getUserId(users, 'khalid');
  const inviteId = fixedUuid(701);
  await prisma.lobbyInvite.upsert({
    where: { id: inviteId },
    create: {
      id: inviteId,
      lobbyId: lobbyIds.cs2,
      inviterId: getUserId(users, 'john'),
      inviteeId: khalidId,
      status: InviteStatus.PENDING,
      createdAt: shiftedDate(now, -35 * MINUTE_MS),
    },
    update: {
      status: InviteStatus.PENDING,
      respondedAt: null,
    },
  });

  const marinaCommentId = commentIds[`${momentIds.party}:marina`];
  const timCommentId = commentIds[`${momentIds.hike}:tim`];
  if (!marinaCommentId || !timCommentId) {
    throw new Error('Notification comments were not seeded');
  }

  const notifications = [
    {
      actor: 'alex',
      type: NotificationType.LOBBY_JOINED,
      lobbyId: lobbyIds.beer,
      createdAt: shiftedDate(now, -2 * MINUTE_MS),
    },
    {
      actor: 'marina',
      type: NotificationType.MOMENT_COMMENTED,
      momentId: momentIds.party,
      commentId: marinaCommentId,
      createdAt: shiftedDate(now, -15 * MINUTE_MS),
    },
    {
      actor: 'dan',
      type: NotificationType.MOMENT_LIKED,
      momentId: momentIds.party,
      createdAt: shiftedDate(now, -23 * MINUTE_MS),
    },
    {
      actor: 'john',
      type: NotificationType.LOBBY_INVITED,
      lobbyId: lobbyIds.cs2,
      createdAt: shiftedDate(now, -35 * MINUTE_MS),
    },
    {
      actor: 'kate',
      type: NotificationType.LOBBY_JOINED,
      lobbyId: lobbyIds.basketball,
      createdAt: shiftedDate(now, -60 * MINUTE_MS),
      readAt: shiftedDate(now, -30 * MINUTE_MS),
    },
    {
      actor: 'tim',
      type: NotificationType.MOMENT_COMMENTED,
      momentId: momentIds.hike,
      commentId: timCommentId,
      createdAt: shiftedDate(now, -120 * MINUTE_MS),
      readAt: shiftedDate(now, -90 * MINUTE_MS),
    },
    {
      actor: 'anna',
      type: NotificationType.MOMENT_LIKED,
      momentId: momentIds.hike,
      createdAt: shiftedDate(now, -180 * MINUTE_MS),
      readAt: shiftedDate(now, -150 * MINUTE_MS),
    },
    {
      actor: 'max',
      type: NotificationType.LOBBY_JOINED,
      lobbyId: lobbyIds.cinema,
      createdAt: shiftedDate(now, -DAY_MS),
      readAt: shiftedDate(now, -23 * 60 * MINUTE_MS),
    },
  ];

  for (const [index, notification] of notifications.entries()) {
    const id = fixedUuid(801 + index);
    const { actor, ...data } = notification;
    const persistenceData = {
      ...data,
      recipientId: khalidId,
      actorId: getUserId(users, actor),
    };
    await prisma.notification.upsert({
      where: { id },
      create: { id, ...persistenceData },
      update: persistenceData,
    });
  }
}

async function printSummary(): Promise<void> {
  const [users, lobbies, joinedMembers, messages, moments, likes, comments, notifications] = await Promise.all([
    prisma.user.count(),
    prisma.lobby.count(),
    prisma.lobbyMember.count({ where: { status: LobbyMemberStatus.JOINED } }),
    prisma.lobbyMessage.count(),
    prisma.moment.count(),
    prisma.momentLike.count(),
    prisma.momentComment.count(),
    prisma.notification.count(),
  ]);

  console.log('PartyMaker demo seed completed:');
  console.log(JSON.stringify({
    users,
    lobbies,
    joinedMembers,
    messages,
    moments,
    likes,
    comments,
    notifications,
  }, null, 2));
}

async function main(): Promise<void> {
  const now = new Date();
  const users = await seedUsers();
  const mediaIds = await seedMedia(users);
  await seedLobbies(users, now);
  await seedLobbyMedia(mediaIds);
  await seedMessages(users, now);
  const commentIds = await seedMoments(users, mediaIds, now);
  await seedActivity(users, commentIds, now);
  await printSummary();
}

main()
  .catch((error: unknown) => {
    console.error('PartyMaker demo seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
