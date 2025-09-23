import React, { useState } from 'react';

interface TrainingPlan {
  id: number;
  name: string;
  description: string;
}

const TrainingPlans: React.FC = () => {
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleAddPlan = () => {
    if (!name) return;
    const newPlan: TrainingPlan = {
      id: Date.now(),
      name,
      description,
    };
    setPlans([...plans, newPlan]);
    setName('');
    setDescription('');
  };

  const handleDelete = (id: number) => {
    setPlans(plans.filter(plan => plan.id !== id));
  };

  return (
    <div className="min-h-screen p-6 bg-gray-50 dark:bg-gray-900">
      <h1 className="text-3xl font-bold mb-6 text-center text-gray-800 dark:text-gray-100">Training Plans</h1>

      <div className="mb-6 max-w-md mx-auto">
        <input
          type="text"
          placeholder="Plan Name"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full p-2 mb-2 border rounded"
        />
        <input
          type="text"
          placeholder="Description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="w-full p-2 mb-2 border rounded"
        />
        <button
          onClick={handleAddPlan}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
        >
          Add Plan
        </button>
      </div>

      <div className="max-w-md mx-auto space-y-4">
        {plans.length === 0 && <p className="text-gray-600 dark:text-gray-300 text-center">No training plans yet.</p>}
        {plans.map(plan => (
          <div key={plan.id} className="p-4 bg-white dark:bg-gray-800 rounded shadow">
            <h2 className="font-bold text-gray-800 dark:text-gray-100">{plan.name}</h2>
            <p className="text-gray-600 dark:text-gray-300">{plan.description}</p>
            <button
              onClick={() => handleDelete(plan.id)}
              className="mt-2 text-red-500 hover:underline text-sm"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TrainingPlans;