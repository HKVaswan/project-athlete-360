// src/pages/AttendancePage.tsx
import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { attendanceService } from "../services/attendanceService";
import { athletesService } from "../services/athletesService";
import { Athlete, AttendanceRecord } from "../types";

const AttendancePage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!sessionId) return;

      setLoading(true);
      setError(null);

      try {
        // Fetch athletes (filter by team/session if needed)
        const athletesData = await athletesService.getAthletes();
        setAthletes(athletesData);

        // Fetch attendance records
        const attendanceData: AttendanceRecord[] = await attendanceService.getAttendance(sessionId);
        const attendanceMap: Record<string, boolean> = {};
        attendanceData.forEach((record) => {
          attendanceMap[record.athleteId] = record.present;
        });
        setAttendance(attendanceMap);
      } catch (err) {
        console.error(err);
        setError("Failed to fetch attendance data.");
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
      setAttendance((prev) => ({ ...prev, [athleteId]: newStatus }));
    } catch (err) {
      console.error(err);
      alert("Failed to update attendance.");
    }
  };

  if (loading) return <p className="text-center mt-8">Loading attendance...</p>;
  if (error) return <p className="text-center mt-8 text-red-500">{error}</p>;

  return (
    <div className="p-6 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6 text-center">Attendance</h1>
      {athletes.length === 0 ? (
        <p className="text-gray-500 text-center">No athletes found for this session.</p>
      ) : (
        <ul className="space-y-2">
          {athletes.map((athlete) => (
            <li
              key={athlete.id}
              className="flex justify-between items-center p-2 border rounded bg-white dark:bg-gray-800 shadow-sm"
            >
              <span className="text-gray-800 dark:text-gray-200">{athlete.name}</span>
              <button
                onClick={() => toggleAttendance(athlete.id)}
                className={`px-3 py-1 rounded font-semibold transition-colors ${
                  attendance[athlete.id]
                    ? "bg-green-500 hover:bg-green-600 text-white"
                    : "bg-red-500 hover:bg-red-600 text-white"
                }`}
              >
                {attendance[athlete.id] ? "Present" : "Absent"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AttendancePage;