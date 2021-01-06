import React from "react";
import { message } from "antd";
import { RoomPhase, ViewMode } from "white-web-sdk";

import PageError from "../../PageError";
import LoadingPage from "../../LoadingPage";

import InviteButton from "../../components/InviteButton";
import { TopBar, TopBarDivider } from "../../components/TopBar";
import { TopBarRoundBtn } from "../../components/TopBarRoundBtn";
import { TopBarRightBtn } from "../../components/TopBarRightBtn";
import { RealtimePanel } from "../../components/RealtimePanel";
import { ChatPanel } from "../../components/ChatPanel";
import { SmallClassAvatar } from "./SmallClassAvatar";
import { NetworkStatus } from "../../components/NetworkStatus";
import { RecordButton } from "../../components/RecordButton";
import { ClassStatus } from "../../components/ClassStatus";
import { withWhiteboardRoute, WithWhiteboardRouteProps } from "../../components/Whiteboard";
import { withRtcRoute, WithRtcRouteProps } from "../../components/Rtc";
import { withRtmRoute, WithRtmRouteProps } from "../../components/Rtm";
import { RTMUser } from "../../components/ChatPanel/ChatUser";

import { getRoom, Identity } from "../../utils/localStorage/room";
import { ipcAsyncByMain } from "../../utils/ipc";
import { RtcChannelType } from "../../apiMiddleware/Rtc";
import { ClassModeType } from "../../apiMiddleware/Rtm";

import "./SmallClassPage.less";

export enum ClassStatusType {
    idle,
    started,
    paused,
    stopped,
}

export type SmallClassPageProps = WithWhiteboardRouteProps & WithRtcRouteProps & WithRtmRouteProps;

export type SmallClassPageState = {
    isRealtimeSideOpen: boolean;
    classStatus: ClassStatusType;
};

class SmallClassPage extends React.Component<SmallClassPageProps, SmallClassPageState> {
    public constructor(props: SmallClassPageProps) {
        super(props);

        this.state = {
            isRealtimeSideOpen: true,
            classStatus: ClassStatusType.idle,
        };

        ipcAsyncByMain("set-win-size", {
            width: 1200,
            height: 700,
        });

        const room = getRoom(props.match.params.uuid);
        if (room?.roomName) {
            document.title = room.roomName;
        }
    }

    componentDidMount() {
        const { isCalling, toggleCalling } = this.props.rtc;
        if (!isCalling) {
            toggleCalling();
        }
    }

    public render(): React.ReactNode {
        const { room, phase } = this.props.whiteboard;

        if (room === null || room === undefined) {
            return <LoadingPage />;
        }

        switch (phase) {
            case RoomPhase.Connecting ||
                RoomPhase.Disconnecting ||
                RoomPhase.Reconnecting ||
                RoomPhase.Reconnecting: {
                return <LoadingPage />;
            }
            case RoomPhase.Disconnected: {
                return <PageError />;
            }
            default: {
                return this.renderWhiteBoard();
            }
        }
    }

    private handleRoomController = (): void => {
        const { room } = this.props.whiteboard;
        if (!room) {
            return;
        }
        if (room.state.broadcastState.mode !== ViewMode.Broadcaster) {
            room.setViewMode(ViewMode.Broadcaster);
            message.success("其他用户将跟随您的视角");
        } else {
            room.setViewMode(ViewMode.Freedom);
            message.success("其他用户将停止跟随您的视角");
        }
    };

    private handleSideOpenerSwitch = (): void => {
        this.setState(state => ({ isRealtimeSideOpen: !state.isRealtimeSideOpen }));
    };

    private startClass = (): void => {
        this.setState({ classStatus: ClassStatusType.started });
    };

    private pauseClass = (): void => {
        this.setState({ classStatus: ClassStatusType.paused });
    };

    private resumeClass = (): void => {
        this.setState({ classStatus: ClassStatusType.started });
    };

    private stopClass = (): void => {
        this.setState({ classStatus: ClassStatusType.stopped });
    };

    private openReplayPage = () => {
        // @TODO 打开到当前的录制记录中
        const { uuid, identity, userId } = this.props.match.params;
        this.props.history.push(`/replay/${identity}/${uuid}/${userId}/`);
    };

    private renderWhiteBoard(): React.ReactNode {
        return (
            <div className="realtime-box">
                <TopBar
                    left={this.renderTopBarLeft()}
                    center={this.renderTopBarCenter()}
                    right={this.renderTopBarRight()}
                />
                {this.renderAvatars()}
                <div className="realtime-content">
                    {this.props.whiteboard.whiteboardElement}
                    {this.renderRealtimePanel()}
                </div>
            </div>
        );
    }

    private renderAvatars(): React.ReactNode {
        const { creatorUid } = this.props.rtc;
        const { creator, speakingJoiners, handRaisingJoiners, joiners, classMode } = this.props.rtm;

        if (!creatorUid) {
            return null;
        }

        return (
            <div className="realtime-avatars-wrap">
                <div className="realtime-avatars">
                    {creator && this.renderAvatar(creator)}
                    {speakingJoiners.map(this.renderAvatar)}
                    {classMode === ClassModeType.Interaction && (
                        <>
                            {handRaisingJoiners.map(this.renderAvatar)}
                            {joiners.map(this.renderAvatar)}
                        </>
                    )}
                </div>
            </div>
        );
    }

    private renderTopBarLeft(): React.ReactNode {
        const { identity } = this.props.match.params;
        const { classStatus } = this.state;
        return (
            <>
                <NetworkStatus />
                {identity === Identity.joiner && (
                    <ClassStatus isClassBegin={classStatus === ClassStatusType.started} />
                )}
            </>
        );
    }

    private renderClassMode(): React.ReactNode {
        const { classMode, toggleClassMode } = this.props.rtm;

        return classMode === ClassModeType.Lecture ? (
            <TopBarRoundBtn
                title="当前为讲课模式"
                dark
                iconName="class-interaction"
                onClick={toggleClassMode}
            >
                切换至互动模式
            </TopBarRoundBtn>
        ) : (
            <TopBarRoundBtn
                title="当前为互动模式"
                dark
                iconName="class-lecture"
                onClick={toggleClassMode}
            >
                切换至讲课模式
            </TopBarRoundBtn>
        );
    }

    private renderTopBarCenter(): React.ReactNode {
        const { identity } = this.props.match.params;
        const { classStatus } = this.state;

        if (identity !== Identity.creator) {
            return null;
        }

        switch (classStatus) {
            case ClassStatusType.started:
                return (
                    <>
                        {this.renderClassMode()}
                        <TopBarRoundBtn iconName="class-pause" onClick={this.pauseClass}>
                            暂停上课
                        </TopBarRoundBtn>
                        <TopBarRoundBtn iconName="class-stop" onClick={this.stopClass}>
                            结束上课
                        </TopBarRoundBtn>
                    </>
                );
            case ClassStatusType.paused:
                return (
                    <>
                        {this.renderClassMode()}
                        <TopBarRoundBtn iconName="class-pause" onClick={this.resumeClass}>
                            恢复上课
                        </TopBarRoundBtn>
                        <TopBarRoundBtn iconName="class-stop" onClick={this.stopClass}>
                            结束上课
                        </TopBarRoundBtn>
                    </>
                );
            default:
                return (
                    <TopBarRoundBtn iconName="class-begin" onClick={this.startClass}>
                        开始上课
                    </TopBarRoundBtn>
                );
        }
    }

    private renderTopBarRight(): React.ReactNode {
        const { viewMode, toggleDocCenter } = this.props.whiteboard;
        const { isRecording, toggleRecording } = this.props.rtc;
        const { isRealtimeSideOpen } = this.state;
        const { uuid, identity } = this.props.match.params;
        const isCreator = identity === Identity.creator;

        return (
            <>
                {isCreator && (
                    <RecordButton
                        // @TODO 待填充逻辑
                        disabled={false}
                        isRecording={isRecording}
                        onClick={toggleRecording}
                    />
                )}
                {isCreator && (
                    <TopBarRightBtn
                        title="Vision control"
                        icon="follow"
                        active={viewMode === ViewMode.Broadcaster}
                        onClick={this.handleRoomController}
                    />
                )}
                <TopBarRightBtn title="Docs center" icon="folder" onClick={toggleDocCenter} />
                <InviteButton uuid={uuid} />
                {/* @TODO implement Options menu */}
                <TopBarRightBtn title="Options" icon="options" onClick={() => {}} />
                <TopBarDivider />
                <TopBarRightBtn
                    title="Open side panel"
                    icon="hide-side"
                    active={isRealtimeSideOpen}
                    onClick={this.handleSideOpenerSwitch}
                />
            </>
        );
    }

    private renderRealtimePanel(): React.ReactNode {
        const { uuid, userId, identity } = this.props.match.params;

        const { isRealtimeSideOpen } = this.state;

        return (
            <RealtimePanel
                isShow={isRealtimeSideOpen}
                isVideoOn={false}
                videoSlot={null}
                chatSlot={
                    <ChatPanel
                        userId={userId}
                        channelID={uuid}
                        identity={identity}
                        rtm={this.props.rtm}
                        allowMultipleSpeakers={true}
                    ></ChatPanel>
                }
            />
        );
    }

    private renderAvatar = (user: RTMUser): React.ReactNode => {
        const { userId, identity } = this.props.match.params;
        const { rtcEngine } = this.props.rtc.rtc;
        const { updateDeviceState } = this.props.rtm;

        return (
            <SmallClassAvatar
                key={user.id}
                identity={identity}
                userId={userId}
                user={user}
                rtcEngine={rtcEngine}
                updateDeviceState={updateDeviceState}
            />
        );
    };
}

export default withWhiteboardRoute(
    withRtcRoute({
        recordingConfig: {
            channelType: RtcChannelType.Communication,
            transcodingConfig: {
                width: 288,
                height: 216,
                // https://docs.agora.io/cn/cloud-recording/recording_video_profile
                fps: 15,
                bitrate: 140,
            },
            subscribeUidGroup: 3,
        },
    })(withRtmRoute(SmallClassPage)),
);