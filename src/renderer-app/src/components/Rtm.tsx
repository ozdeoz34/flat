import React from "react";
import { RouteComponentProps } from "react-router";
import { v4 as uuidv4 } from "uuid";
import dateSub from "date-fns/sub";
import { ClassModeType, Rtm as RtmApi, RTMessage, RTMessageType } from "../apiMiddleware/Rtm";
import { Identity } from "../utils/localStorage/room";
import { ChatMessageItem } from "./ChatPanel/ChatMessage";
import { RTMUser } from "./ChatPanel/ChatUser";
import { usersInfo } from "../apiMiddleware/flatServer";

export interface RtmRenderProps extends RtmState {
    rtm: RtmApi;
    updateHistory: () => Promise<void>;
    acceptRaisehand: (userUUID: string) => void;
    onMessageSend: (text: string) => Promise<void>;
    onCancelAllHandRaising: () => void;
    onToggleHandRaising: () => void;
    onToggleBan: () => void;
    onSpeak: (configs: Array<{ userUUID: string; speak: boolean }>) => void;
    updateDeviceState: (userUUID: string, camera: boolean, mic: boolean) => void;
    toggleClassMode: () => void;
}

export interface RtmProps {
    children: (props: RtmRenderProps) => React.ReactNode;
    roomId: string;
    userId: string;
    identity: Identity;
}

export type RtmState = {
    messages: ChatMessageItem[];
    speakingJoiners: RTMUser[];
    handRaisingJoiners: RTMUser[];
    joiners: RTMUser[];
    currentUser: RTMUser | null;
    isBan: boolean;
    classMode: ClassModeType;
    creator?: RTMUser;
};

export class Rtm extends React.Component<RtmProps, RtmState> {
    private rtm = new RtmApi();
    private noMoreRemoteMessages = false;

    constructor(props: RtmProps) {
        super(props);

        this.state = {
            messages: [],
            speakingJoiners: [],
            handRaisingJoiners: [],
            joiners: [],
            currentUser: null,
            isBan: false,
            classMode: ClassModeType.Lecture,
        };
    }

    async componentDidMount() {
        const { userId, roomId, identity } = this.props;
        const channel = await this.rtm.init(userId, roomId);
        this.startListenChannel();

        // @TODO 使用我们自己的服务器记录类型
        if (identity === Identity.creator) {
            this.rtm.client.addOrUpdateChannelAttributes(
                roomId,
                { creatorId: userId },
                { enableNotificationToChannelMembers: true },
            );
            this.setState({ creator: (await this.createUsers([userId]))[0] });
        } else {
            channel.on("AttributesUpdated", this.updateChannelAttrs);
            this.updateChannelAttrs(await this.rtm.client.getChannelAttributes(roomId));
        }

        this.updateHistory();

        const members = await channel.getMembers();
        this.sortUsers(await this.createUsers(members));

        channel.on("MemberJoined", async userUUID => {
            this.sortUsers(await this.createUsers([userUUID]));
        });
        channel.on("MemberLeft", userUUID => {
            this.setState(state => ({
                joiners: state.joiners.filter(user => user.uuid !== userUUID),
            }));
        });
    }

    componentWillUnmount() {
        this.rtm.destroy();
    }

    render(): React.ReactNode {
        return this.props.children({
            ...this.state,
            rtm: this.rtm,
            acceptRaisehand: this.acceptRaisehand,
            updateHistory: this.updateHistory,
            onMessageSend: this.onMessageSend,
            onCancelAllHandRaising: this.onCancelAllHandRaising,
            onToggleHandRaising: this.onToggleHandRaising,
            onToggleBan: this.onToggleBan,
            onSpeak: this.onSpeak,
            updateDeviceState: this.updateDeviceState,
            toggleClassMode: this.toggleClassMode,
        });
    }

    private acceptRaisehand = (userUUID: string): void => {
        if (this.props.identity === Identity.creator) {
            this.sortUsers(user =>
                userUUID === user.uuid
                    ? {
                          ...user,
                          isRaiseHand: false,
                          isSpeak: true,
                          camera: false,
                          mic: true,
                      }
                    : user,
            );
            this.rtm.sendCommand(RTMessageType.AcceptRaiseHand, { userUUID, accept: true });
        }
    };

    private onSpeak = (configs: { userUUID: string; speak: boolean }[]): void => {
        const { identity, userId } = this.props;
        if (identity !== Identity.creator) {
            // joiner can only turn off speaking
            configs = configs.filter(config => !config.speak && config.userUUID === userId);
            if (configs.length <= 0) {
                return;
            }
        }
        this.speak(configs);
        this.rtm.sendCommand(RTMessageType.Speak, configs);
    };

    private onMessageSend = async (text: string): Promise<void> => {
        if (this.state.isBan && this.props.identity !== Identity.creator) {
            return;
        }
        await this.rtm.sendMessage(text);
        this.addMessage(RTMessageType.ChannelMessage, text, this.props.userId);
    };

    private onCancelAllHandRaising = (): void => {
        if (this.props.identity === Identity.creator) {
            this.cancelAllHandRaising();
            this.rtm.sendCommand(RTMessageType.CancelAllHandRaising, true, true);
        }
    };

    /** joiner updates own camera and mic state */
    private updateDeviceState = (uid: string, camera: boolean, mic: boolean): void => {
        const { identity, userId } = this.props;
        if (userId === uid || identity === Identity.creator) {
            this.sortUsers(
                user => {
                    if (user.uuid === uid) {
                        // creator can turn off joiner's camera and mic
                        // creator can request joiner to turn on camera and mic
                        if (uid !== userId) {
                            if (camera && !user.camera) {
                                camera = user.camera;
                            }

                            if (mic && !user.mic) {
                                mic = user.mic;
                            }
                        }

                        if (camera !== user.camera || mic !== user.mic) {
                            return { ...user, isRaiseHand: false, camera, mic };
                        }
                    }
                    return user;
                },
                () => {
                    this.rtm.sendCommand(RTMessageType.DeviceState, { camera, mic }, true);
                },
            );
        }
    };

    private onToggleBan = (): void => {
        const { identity, userId } = this.props;
        if (identity !== Identity.creator) {
            return;
        }
        this.setState(
            state => ({
                isBan: !state.isBan,
                messages: [
                    ...state.messages,
                    {
                        type: RTMessageType.BanText,
                        uuid: uuidv4(),
                        timestamp: Date.now(),
                        value: !state.isBan,
                        userId,
                    },
                ],
            }),
            () => {
                this.rtm.sendCommand(RTMessageType.BanText, this.state.isBan, true);
            },
        );
    };

    // Current user (who is a joiner) raises hand
    private onToggleHandRaising = (): void => {
        const { userId, identity } = this.props;
        const { currentUser } = this.state;
        if (identity !== Identity.joiner || currentUser?.isSpeak) {
            return;
        }
        this.sortUsers(
            user => (user.uuid === userId ? { ...user, isRaiseHand: !user.isRaiseHand } : user),
            () => {
                const { currentUser } = this.state;
                if (currentUser) {
                    this.rtm.sendCommand(RTMessageType.RaiseHand, currentUser.isRaiseHand, true);
                }
            },
        );
    };

    /** Add the new message to message list */
    private addMessage = (
        type: RTMessageType.ChannelMessage | RTMessageType.Notice,
        value: string,
        senderId: string,
    ): void => {
        this.setState(state => {
            const timestamp = Date.now();
            const messages = [...state.messages];
            let insertPoint = 0;
            while (insertPoint < messages.length && messages[insertPoint].timestamp <= timestamp) {
                insertPoint++;
            }
            messages.splice(insertPoint, 0, {
                type,
                uuid: uuidv4(),
                timestamp,
                value,
                userId: senderId,
            });
            return { messages };
        });
    };

    private cancelAllHandRaising = (): void => {
        this.sortUsers(user => (user.isRaiseHand ? { ...user, isRaiseHand: false } : user));
    };

    private speak = (configs: Array<{ userUUID: string; speak: boolean }>): void => {
        const configMap = new Map(configs.map(config => [config.userUUID, config]));
        this.sortUsers(user => {
            const config = configMap.get(user.uuid);
            return config
                ? config.speak
                    ? { ...user, isSpeak: true, isRaiseHand: false }
                    : { ...user, isSpeak: false, isRaiseHand: false, camera: false, mic: false }
                : user;
        });
    };

    private startListenChannel = (): void => {
        this.rtm.on(RTMessageType.ChannelMessage, (text, senderId) => {
            this.addMessage(RTMessageType.ChannelMessage, text, senderId);
        });

        this.rtm.on(RTMessageType.CancelAllHandRaising, (_value, senderId) => {
            if (senderId === this.state.creator?.uuid && this.props.identity === Identity.joiner) {
                this.cancelAllHandRaising();
            }
        });

        this.rtm.on(RTMessageType.RaiseHand, (isRaiseHand, senderId) => {
            this.sortUsers(user =>
                user.uuid === senderId && (!isRaiseHand || !user.isSpeak)
                    ? { ...user, isRaiseHand }
                    : user,
            );
        });

        this.rtm.on(RTMessageType.AcceptRaiseHand, ({ userUUID, accept }, senderId) => {
            if (senderId === this.state.creator?.uuid) {
                this.sortUsers(user =>
                    userUUID === user.uuid
                        ? {
                              ...user,
                              isRaiseHand: false,
                              isSpeak: accept,
                              camera: false,
                              mic: accept,
                          }
                        : user,
                );
            }
        });

        this.rtm.on(RTMessageType.BanText, (isBan, senderId) => {
            if (senderId === this.state.creator?.uuid && this.props.identity === Identity.joiner) {
                this.setState(state => ({
                    isBan,
                    messages: [
                        ...state.messages,
                        {
                            type: RTMessageType.BanText,
                            uuid: uuidv4(),
                            timestamp: Date.now(),
                            value: isBan,
                            userId: this.props.userId,
                        },
                    ],
                }));
            }
        });

        this.rtm.on(RTMessageType.DeviceState, ({ camera, mic }, senderId) => {
            this.sortUsers(user =>
                user.uuid === senderId
                    ? { ...user, isSpeak: user.isSpeak && (camera || mic), camera, mic }
                    : user,
            );
        });

        this.rtm.on(RTMessageType.Speak, (configs, senderId) => {
            if (senderId !== this.state.creator?.uuid) {
                // joiner can only turn off speaking
                configs = configs.filter(config => !config.speak && config.userUUID === senderId);
                if (configs.length <= 0) {
                    return;
                }
            }
            this.speak(configs);
        });

        this.rtm.on(RTMessageType.Notice, (text, senderId) => {
            if (senderId === this.state.creator?.uuid) {
                this.addMessage(RTMessageType.Notice, text, senderId);
            }
        });

        this.rtm.on(RTMessageType.ClassMode, (classMode, senderId) => {
            if (senderId === this.state.creator?.uuid) {
                this.setState({ classMode });
            }
        });
    };

    private updateHistory = async (): Promise<void> => {
        if (this.noMoreRemoteMessages) {
            return;
        }

        let messages: RTMessage[] = [];

        try {
            const oldestTimestap = this.state.messages[0]?.timestamp || Date.now();
            messages = await this.rtm.fetchTextHistory(
                dateSub(oldestTimestap, { years: 1 }).valueOf(),
                oldestTimestap - 1,
            );
        } catch (e) {
            console.warn(e);
        }

        if (messages.length <= 0) {
            this.noMoreRemoteMessages = true;
            return;
        }

        const textMessages = messages.filter(
            (message): message is RTMessage =>
                message.type === RTMessageType.ChannelMessage ||
                message.type === RTMessageType.Notice,
        );

        this.setState(state => ({ messages: [...textMessages, ...state.messages] }));
    };

    private updateChannelAttrs = async (attrs: {
        [index: string]: { value: string };
    }): Promise<void> => {
        if (attrs.creatorId?.value !== undefined) {
            const creatorId = attrs.creatorId.value;
            if (!this.state.creator) {
                this.setState({ creator: (await this.createUsers([creatorId]))[0] });
            }
        }
    };

    private toggleClassMode = (): void => {
        this.setState(
            state => ({
                classMode:
                    state.classMode === ClassModeType.Lecture
                        ? ClassModeType.Interaction
                        : ClassModeType.Lecture,
            }),
            () => {
                this.rtm.sendCommand(RTMessageType.ClassMode, this.state.classMode);
            },
        );
    };

    /**
     * Sort users into different groups.
     * @param mapUser Update a user state. Return the same object if not modified.
     * @param setStateCallback
     */
    private sortUsers(
        mapUser: (user: RTMUser, state: RtmState) => RTMUser,
        setStateCallback?: () => void,
    ): void;
    /**
     * ort users into different groups.
     * @param unSortedUsers A list of unsorted users
     * @param setStateCallback
     */
    private sortUsers(unsortedUsers: RTMUser[], setStateCallback?: () => void): void;
    private sortUsers(
        mapUserOrUnsortedUsers: ((user: RTMUser, state: RtmState) => RTMUser) | RTMUser[],
        setStateCallback?: () => void,
    ): void {
        this.setState(state => {
            const { userId } = this.props;
            const mapUser: ((user: RTMUser, state: RtmState) => RTMUser) | null = Array.isArray(
                mapUserOrUnsortedUsers,
            )
                ? null
                : mapUserOrUnsortedUsers;
            const unSortedUsers: RTMUser[] = mapUser ? [] : (mapUserOrUnsortedUsers as RTMUser[]);

            const newState: Partial<RtmState> = {};

            if (mapUser) {
                if (state.creator) {
                    newState.creator = mapUser(state.creator, state);
                }

                // Pick updated users out of these three groups to an unsorted group
                (["speakingJoiners", "handRaisingJoiners", "joiners"] as const).forEach(key => {
                    for (let i = 0; i < state[key].length; i++) {
                        const user = state[key][i];
                        const mappedUser = mapUser(user, state);
                        // If mapUser returns a new object
                        // that means this is a updated user
                        if (user !== mappedUser) {
                            if (!newState[key]) {
                                // lazy-create new state field
                                // concat items before current updated user
                                newState[key] = state.joiners.slice(0, i);
                            }
                            unSortedUsers.push(mappedUser);
                            continue;
                        }
                        // if new state filed is created
                        // it is going to be committed to next React state
                        // so keep adding the rest of the items
                        newState[key]?.push(user);
                    }
                });
            }

            // sort each unsorted users into different group
            // all groups in new state are lazy-created
            for (const user of unSortedUsers) {
                const isCurrentUser = user.uuid === userId;

                if (isCurrentUser) {
                    newState.currentUser = user;
                }

                if (user.uuid === state.creator?.uuid) {
                    newState.creator = user;
                } else if (user.isSpeak) {
                    if (!newState.speakingJoiners) {
                        newState.speakingJoiners = [...state.speakingJoiners];
                    }
                    newState.speakingJoiners.push(user);
                } else if (user.isRaiseHand) {
                    if (!newState.handRaisingJoiners) {
                        newState.handRaisingJoiners = [...state.handRaisingJoiners];
                    }
                    newState.handRaisingJoiners.push(user);
                } else if (isCurrentUser) {
                    if (!newState.joiners) {
                        newState.joiners = [...state.joiners];
                    }
                    newState.joiners.unshift(user);
                } else {
                    if (!newState.joiners) {
                        newState.joiners = [...state.joiners];
                    }
                    newState.joiners.push(user);
                }
            }

            return newState as RtmState;
        }, setStateCallback);
    }

    private createUsers = async (userUUIDs: string[]): Promise<RTMUser[]> => {
        const users = await usersInfo({ roomUUID: this.props.roomId, usersUUID: userUUIDs });

        return userUUIDs.map(
            (userUUID): RTMUser => ({
                uuid: userUUID,
                rtcUID: users[userUUID].rtcUID,
                avatar: users[userUUID].avatarURL,
                name: users[userUUID].name,
                camera: userUUID !== this.props.userId,
                mic: true,
                isSpeak: false,
                isRaiseHand: false,
            }),
        );
    };
}

export type WithRtmRouteProps = { rtm: RtmRenderProps } & RouteComponentProps<{
    identity: Identity;
    uuid: string;
    userId: string;
}>;

export function withRtmRoute<Props>(Comp: React.ComponentType<Props & WithRtmRouteProps>) {
    return class WithRtmRoute extends React.Component<
        Props & Omit<WithRtmRouteProps, "whiteboard">
    > {
        render() {
            const { uuid, userId, identity } = this.props.match.params;
            return (
                <Rtm roomId={uuid} userId={userId} identity={identity}>
                    {this.renderChildren}
                </Rtm>
            );
        }

        renderChildren = (props: RtmRenderProps) => <Comp {...this.props} rtm={props} />;
    };
}
