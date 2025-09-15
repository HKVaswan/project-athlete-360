// src/pages/AttendancePage.tsx

import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { attendanceService } from "../services/attendanceService";
import { athletesService } from "../services/athletesService";
import { Session, AttendanceRecord, Athlete } from "../types";

const AttendancePage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!sessionId) return;

      try {
        // Fetch athletes for this session's team
        const athletesData = await athletesService.getAthletes(); // adjust to filter by team if needed
        setAthletes(athletesData);

        // Fetch attendance records for this session
        const attendanceData = await attendanceService.getAttendance(sessionId);
        const attendanceMap: Record<string, boolean> = {};
        attendanceData.forEach((record: AttendanceRecord) => {
          attendanceMap[record.athleteId] = record.present;
        });
        setAttendance(attendanceMap);
      } catch (error) {
        console.error("Failed to fetch attendance data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [sessionId]);

  const toggleAttendance = async (athleteId: string) => {
    if (!sessionId) return;

    const newStatus = !attendance[athleteId];
    try {
      await attendanceService.markAttendance(sessionId, athleteId, newStatus);
      setAttendance((prev) => ({
        ...prev,
        [athleteId]: newStatus,
      }));
    } catch (error) {
      console.error("Failed to update attendance:", error);
    }
  };

  if (loading) {
    return <p>Loading attendance...</p>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Attendance</h1>
      <ul className="space-y-2">
        {athletes.map((athlete) => (
          <li
            key={athlete.id}
            className="flex justify-between items-center p-2 border rounded"
          >
            <span>{athlete.name}</span>
            <button
              onClick={() => toggleAttendance(athlete.id)}
              className={`px-3 py-1 rounded ${
                attendance[athlete.id]
                  ? "bg-green-500 text-white"
                  : "bg-red-500 text-white"
              }`}
            >
              {attendance[athlete.id] ? "Present" : "Absent"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default AttendancePage;
