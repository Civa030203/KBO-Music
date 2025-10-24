import { useState } from "react";
import { motion } from "framer-motion";
import { cheerSongs } from "./oldCheerSongs";
import { Link } from "react-router-dom";

// 기본 Card 컴포넌트
function Card({ children, color }) {
  return <div className={`bg-[${color}] text-white rounded-2xl shadow p-4`}>{children}</div>;
}

function CardContent({ children, className = "" }) {
  return <div className={`w-full ${className}`}>{children}</div>;
}

// 기본 Button 컴포넌트
function Button({ children, onClick, color }) {
  return (
    <button
      onClick={onClick}
      className={`bg-[${color}] hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-xl`}
    >
      {children}
    </button>
  );
}

// 기본 Select 컴포넌트
function Select({ onValueChange, children }) {
  return <div className="relative">{children}</div>;
}

function SelectTrigger({ children }) {
  return (
    <div className="border border-gray-300 rounded-xl px-4 py-2 bg-white cursor-pointer">
      {children}
    </div>
  );
}

function SelectContent({ children }) {
  return <div className="mt-2 space-y-1">{children}</div>;
}

function SelectItem({ children, value, onSelect, cheerSongs, team }) {
  return (
    <div
      className={`px-40 py-2 hover:bg-red-100 rounded-xl cursor-pointer bg-gradient-to-bl from-[${cheerSongs[team].teamColor1}] to-[${cheerSongs[team].teamColor2}]`}
      onClick={() => onSelect?.(value)}
    >
      {children}
    </div>
  );
}

const App = () => {
  const [selectedTeam, setSelectedTeam] = useState("");
  const [currentSong, setCurrentSong] = useState(null);
  const [selectedSongTeam, setSelectedSongTeam] = useState(null);
  const [selectedSongTeamID, setSelectedSongTeamID] = useState(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-100 to-white p-4 md:p-10">
      {/* 상단 타이틀바 */}
      <div className="bg-red-500 text-white text-xl font-bold px-6 py-4 shadow-md fixed top-0 left-0 w-full z-50">
        <h1>프로야구 응원가 플레이어</h1>
      </div>

      {/* 메인 컨텐츠 - 좌우 분할 */}
      <div className="pt-24 grid grid-cols-1 md:grid-cols-2 max-w-7xl mx-auto">
        {/* 왼쪽: 팀 선택 + 곡 리스트 */}
        <div>
          {currentSong ?
            (<div className="h-[350px] md:h-0"/>) :
            (<div/>)
          }
          <div className="max-w-md mx-auto mb-6">
            <Link to="/">Main</Link>
            <Select>
              <SelectTrigger><h3>{"선택된 팀 : " + selectedTeam || "팀을 선택하세요"}</h3></SelectTrigger>
              <h3> TEAM LIST </h3>
              <SelectContent>
                {Object.keys(cheerSongs).map((team) => (
                  <SelectItem
                    key={team}
                    value={team}
                    onSelect={(val) => setSelectedTeam(val)}
                    cheerSongs={cheerSongs}
                    team={team}
                  >
                  <div>
                    <img
                      src={cheerSongs[team].logo}
                      alt={`${team} 로고`}
                      className={"mb-2"}
                      style={{ width: "160px", height: "160px" }}
                    />
                  </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTeam && (
            <div className="flex flex-col items-center mb-6">
              <div className="w-20 h-20 mb-2">
                <img
                  src={cheerSongs[selectedTeam].logo}
                  alt={`${selectedTeam} 로고`}
                  className="mb-2"
                  style={{ maxWidth: "80px", maxHeight: "80px" }}
                />
              </div>
              <h2 className="text-2xl font-bold">{selectedTeam}</h2>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {selectedTeam &&
              cheerSongs[selectedTeam].songs.map((song, index) => (
                <motion.div
                  key={index + 2}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                >
                  <Card
                    color={cheerSongs[selectedTeam].teamColor1}>
                    <CardContent className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* 프로필 이미지 틀 */}
                          <div className="w-10 h-10 rounded-full overflow-hidden">
                            {song.link ? (<img
                                src={`${song.link}`} // 사용자가 제공한 이미지 경로 입력
                                alt={`${song.title} 프로필`}
                                className="w-full h-full object-cover"
                              />) :
                              (<img
                                src={`http://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/person/middle/${song.memory}/${song.playerID}.jpg`} // 사용자가 제공한 이미지 경로 입력
                                alt={`${song.title} 프로필`}
                                className="w-full h-full object-cover"
                              />)
                            }
                        </div>
                        <div className="text-xs font-bold">{song.title}</div>
                      </div>
                      <Button onClick={
                        function () {
                          setCurrentSong(song);
                          setSelectedSongTeam(cheerSongs[selectedTeam]);
                          setSelectedSongTeamID(cheerSongs[selectedTeam].teamID);
                        }
                      }
                      color={cheerSongs[selectedTeam].teamColor2}>재생</Button>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
          </div>
        </div>

        {/* 오른쪽: 현재 재생 중인 곡 */}
        <div className="relative">
          <div className="fixed top-16 left-0 right-0 z-50 md:sticky md:top-24 flex flex-col items-center justify-start">
            {currentSong ?
              (
                <div className={`bg-gradient-to-bl from-[${selectedSongTeam.teamColor1}] to-[${selectedSongTeam.teamColor2}] shadow-lg rounded-xl p-6 w-full max-w-md text-white`}>
                  <div className="mb-4 font-medium flex items-center gap-4">
                    <span>{currentSong.title}</span>
                    <div className="w-2xl h-2xl rounded-full overflow-hidden mb-4">
                      {currentSong.link ?
                        (
                          <img
                          src={`${currentSong.link}`}
                          alt={`${currentSong.title} 프로필`}
                          className="w-24 h-24 object-cover"
                          />
                        ) :
                        (
                          <img
                          src={`http://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/person/middle/${currentSong.memory}/${currentSong.playerID}.jpg`}
                          alt={`${currentSong.title} 프로필`}
                          className="w-full h-full object-cover"
                          />
                        )
                      }
                    </div>
                  </div>
                  <div>
                    <audio controls autoPlay src={`https://civa030203.github.io/KBO-Music/music/player/old/${selectedSongTeamID}/${currentSong.playerID}.mp3`} className="w-full"></audio>
                    <h3 className="grid place-items-center font-medium">{`${currentSong.misc}`}</h3>
                    <h1 className="grid place-items-center font-bold">가사</h1>
                    <h2 className="italic whitespace-pre-wrap">{`${currentSong.lyrics}`}</h2>
                  </div>
                </div>
              ) : (
                <div/>
              // <div className="text-gray-400 italic mt-10">선택된 곡이 없습니다.</div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
