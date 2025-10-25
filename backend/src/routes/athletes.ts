import express from 'express';
import {
  getAthletes,
  getAthleteById,
  createAthlete,
  updateAthlete,
  deleteAthlete,
} from '../controllers/athletes.controller';

const router = express.Router();

router.get('/', getAthletes);
router.get('/:id', getAthleteById);
router.post('/', createAthlete);
router.put('/:id', updateAthlete);
router.delete('/:id', deleteAthlete);

export default router;